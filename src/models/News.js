// src/models/News.js

import mongoose from 'mongoose';

const newsSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    excerpt: {
        type: String,
        required: true
    },
    content: {
        type: String,
        required: true
    },
    image: {
        type: String,
        default: null
    },
    author: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    views: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['draft', 'published'],
        default: 'draft'
    },
    category: {
        type: String,
        enum: ['announcement', 'news', 'promotion', 'event'],
        required: true
    },
    publishedAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Индексүүд - хурдан хайлт хийхэд
newsSchema.index({ status: 1, publishedAt: -1 });
newsSchema.index({ category: 1 });
newsSchema.index({ createdAt: -1 });

const News = mongoose.model('News', newsSchema);

export default News;