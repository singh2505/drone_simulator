const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const axios = require('axios');

const app = express();

// Database Connection Management
let cachedDb = null;

async function connectToDatabase() {
  if (cachedDb) {
    return cachedDb;
  }

  const client = await mongoose.connect(process.env.db_name, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    bufferCommands: false,
    serverSelectionTimeoutMS: 5000
  });

  cachedDb = client;
  return client;
}

// CORS Configuration
const allowedOrigins = [
  'http://localhost:3000',
  'https://your-vercel-app.vercel.app'
];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(express.json());

// File Upload Configuration (Memory Storage)
const upload = multer({ storage: multer.memoryStorage() });

// Drone Schema and Model
const droneSchema = new mongoose.Schema({
  name: String,
  paths: [{
    name: String,
    coordinates: Array,
    createdAt: { type: Date, default: Date.now }
  }],
  drones: [{
    name: String,
    currentPath: { type: mongoose.Schema.Types.ObjectId, ref: 'Path' },
    currentPosition: Number,
    isActive: Boolean,
    color: String
  }],
  createdAt: { type: Date, default: Date.now }
});

const DroneModel = mongoose.model('Drone', droneSchema);

// API Endpoints

// 1. File Upload for Paths (Modified for Memory Storage)
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const fileData = JSON.parse(req.file.buffer.toString());
    
    await connectToDatabase();
    let drone = await DroneModel.findOne();
    if (!drone) {
      drone = new DroneModel({
        name: 'Default Drone',
        paths: [],
        drones: []
      });
    }

    drone.paths.push({
      name: req.body.name || `Path ${drone.paths.length + 1}`,
      coordinates: fileData
    });

    await drone.save();
    
    res.json({ 
      success: true,
      message: 'Path uploaded successfully',
      drone: drone
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error uploading file',
      error: error.message
    });
  }
});

// 2. Get All Paths (With Connection Management)
app.get('/paths', async (req, res) => {
  try {
    await connectToDatabase();
    const drone = await DroneModel.findOne();
    if (!drone) {
      return res.json({ paths: [], drones: [] });
    }
    res.json({
      paths: drone.paths,
      drones: drone.drones
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Search Locations (Mapbox API)
app.get('/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.json([]);
    }

    const response = await axios.get(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`,
      {
        params: {
          access_token: process.env.MAPBOX_ACCESS_TOKEN,
          limit: 5,
          types: 'place,poi'
        }
      }
    );

    res.json(response.data.features.map(feature => ({
      id: feature.id,
      name: feature.place_name,
      coordinates: feature.center.reverse()
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Add Waypoint to Path (With Connection Management)
app.post('/paths/:pathId/waypoints', async (req, res) => {
  try {
    await connectToDatabase();
    const { pathId } = req.params;
    const { coordinates } = req.body;

    const drone = await DroneModel.findOne();
    if (!drone) {
      return res.status(404).json({ error: 'Drone not found' });
    }

    const path = drone.paths.id(pathId);
    if (!path) {
      return res.status(404).json({ error: 'Path not found' });
    }

    path.coordinates.push(coordinates);
    await drone.save();

    res.json({ success: true, path });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Multiple Drone Management (With Connection Management)
app.post('/drones', async (req, res) => {
  try {
    await connectToDatabase();
    const { name, color } = req.body;
    
    let drone = await DroneModel.findOne();
    if (!drone) {
      drone = new DroneModel({
        name: 'Default Drone',
        paths: [],
        drones: []
      });
    }

    const newDrone = {
      name: name || `Drone ${drone.drones.length + 1}`,
      currentPath: null,
      currentPosition: 0,
      isActive: false,
      color: color || `#${Math.floor(Math.random()*16777215).toString(16)}`
    };

    drone.drones.push(newDrone);
    await drone.save();

    res.json({ success: true, drone: newDrone });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Update Drone Position (With Connection Management)
app.put('/drones/:droneId/position', async (req, res) => {
  try {
    await connectToDatabase();
    const { droneId } = req.params;
    const { pathId, position } = req.body;

    const drone = await DroneModel.findOne();
    if (!drone) {
      return res.status(404).json({ error: 'Drone not found' });
    }

    const droneObj = drone.drones.id(droneId);
    if (!droneObj) {
      return res.status(404).json({ error: 'Drone instance not found' });
    }

    droneObj.currentPath = pathId;
    droneObj.currentPosition = position;
    await drone.save();

    res.json({ success: true, drone: droneObj });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Timeline Control (With Connection Management)
app.get('/timeline', async (req, res) => {
  try {
    await connectToDatabase();
    const drone = await DroneModel.findOne();
    if (!drone) {
      return res.json({ paths: [] });
    }

    const timelineData = drone.paths.map(path => ({
      id: path._id,
      name: path.name,
      duration: path.coordinates.length,
      createdAt: path.createdAt
    }));

    res.json(timelineData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Vercel Serverless Export
module.exports = app;