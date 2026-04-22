// src/models/CinemaInfo.js

import mongoose from 'mongoose';

const socialMediaSchema = new mongoose.Schema({
    facebook: { type: String, default: '' },
    instagram: { type: String, default: '' },
    twitter: { type: String, default: '' },
    youtube: { type: String, default: '' }
}, { _id: false });

const workingHoursSchema = new mongoose.Schema({
    monday: { type: String, default: '10:00 - 23:00' },
    tuesday: { type: String, default: '10:00 - 23:00' },
    wednesday: { type: String, default: '10:00 - 23:00' },
    thursday: { type: String, default: '10:00 - 23:00' },
    friday: { type: String, default: '10:00 - 00:00' },
    saturday: { type: String, default: '09:00 - 00:00' },
    sunday: { type: String, default: '09:00 - 23:00' }
}, { _id: false });

const hallInfoSchema = new mongoose.Schema({
    name: { type: String, required: true },
    seats: { type: Number, required: true },
    type: { type: String, required: true },
    price: { type: String, required: true }
}, { _id: false });

const cinemaInfoSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        default: 'Cinema Pro'
    },
    address: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    website: {
        type: String,
        default: ''
    },
    socialMedia: {
        type: socialMediaSchema,
        default: () => ({})
    },
    workingHours: {
        type: workingHoursSchema,
        default: () => ({})
    },
    halls: {
        type: [hallInfoSchema],
        default: []
    },
    aboutUs: {
        type: String,
        default: ''
    },
    termsAndConditions: {
        type: String,
        default: ''
    },
    privacyPolicy: {
        type: String,
        default: ''
    }
}, {
    timestamps: true
});

const CinemaInfo = mongoose.model('CinemaInfo', cinemaInfoSchema);

export default CinemaInfo;