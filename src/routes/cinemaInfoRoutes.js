// src/routes/cinemaInfoRoutes.js

import express from 'express';
import { 
    getCinemaInfo,
    updateCinemaInfo
} from '../controllers/cinemaInfoController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Нийтийн route - байгууллагын мэдээлэл авах
router.get('/', getCinemaInfo);

// Админы route - мэдээлэл шинэчлэх
router.put('/', protect, admin, updateCinemaInfo);

export default router;