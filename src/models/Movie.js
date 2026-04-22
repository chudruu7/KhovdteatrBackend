// src/models/Movie.js

import mongoose from 'mongoose';

// Жүжигчдийн sub-schema
const castSchema = new mongoose.Schema({
    name: { type: String, default: '' },
    role: { type: String, default: '' },
    cast: {
    type: [{ name: String, role: String }],
    default: []}
} );

const movieSchema = new mongoose.Schema({
    title:         { type: String, required: true, trim: true },
    originalTitle: { type: String, default: '' },
    duration:      { type: String, required: true },
    genre:         [{ type: String }],
    rating:        { type: String, enum: ['PG', '13+', '16+', '18+'], default: 'PG' },
    imdb:          { type: String, default: '' },
    status:        { type: String, enum: ['nowShowing', 'comingSoon'], default: 'nowShowing' },
    posterUrl:     { type: String, default: '' },
    description:   { type: String, default: '' },
    trailerUrl:    { type: String, default: '' },
    releaseDate:   { type: Date, default: null },
    // ── Жүжигчид ──────────────────────────────
    cast: [{
        name: { type: String, default: '' },
        role: { type: String, default: '' }
    }],
    isFeatured:    { type: Boolean, default: false }
}, { timestamps: true });

const Movie = mongoose.model('Movie', movieSchema);

export default Movie;