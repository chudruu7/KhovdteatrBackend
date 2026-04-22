
import express from 'express';
import { 
  getSchedulesByDate,
  getScheduleByMovie,
  getOccupiedSeats,
  createSchedule,
  updateSchedule,
  deleteSchedule
} from '../controllers/scheduleController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/',                    getSchedulesByDate);  
router.get('/seats/:scheduleId',   getOccupiedSeats);    
router.get('/:movieId',            getScheduleByMovie);  

// Админы route-ууд
router.post('/',    protect, admin, createSchedule);
router.put('/:id',  protect, admin, updateSchedule);
router.delete('/:id', protect, admin, deleteSchedule);

export default router;