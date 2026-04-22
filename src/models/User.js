// src/models/User.js
import mongoose from 'mongoose';

const ADMIN_DEFAULT_AVATAR = 'https://cdn3d.iconscout.com/3d/premium/thumb/profile-privacy-3d-icon-png-download-8081901.png';
const USER_DEFAULT_AVATAR  = 'https://img.freepik.com/free-psd/3d-illustration-human-avatar-profile_23-2150671142.jpg?semt=ais_hybrid&w=740&q=80';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  phone: { type: String },
 address: { type: String },
 notifications: { type: Boolean, default: true },
  avatarUrl: {
    type: String,
    default: ''   // register үед role-оос хамаарч тохируулна (доор харна уу)
  },
  membershipLevel: {
    type: String,
    enum: ['standard', 'gold', 'platinum'],
    default: 'standard'
  },
  points: {
    type: Number,
    default: 0
  },
  notifications: {
    type: Boolean,
    default: true
  },
  smsAlerts: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Хадгалахаас өмнө avatarUrl автоматаар тохируулах
userSchema.pre('save', function (next) {
  if (!this.avatarUrl) {
    this.avatarUrl = this.role === 'admin' ? ADMIN_DEFAULT_AVATAR : USER_DEFAULT_AVATAR;
  }
  next();
});

const User = mongoose.model('User', userSchema);
export default User;