// src/routes/movieRoutes.js

import express from 'express';
import { 
    getMovies,
    getMovieById,
    createMovie,
    updateMovie,
    deleteMovie
} from '../controllers/movieController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

// Нийтийн route-ууд
router.get('/', getMovies);
router.get('/:id', getMovieById);

// Админы route-ууд (хамгаалагдсан)
router.post('/', protect, admin, createMovie); // ЭНЭ МӨР БАЙХ ЁСТОЙ
router.put('/:id', protect, admin, updateMovie);
router.delete('/:id', protect, admin, deleteMovie);

export default router;