// src/controllers/movieController.js

import Movie from '../models/Movie.js';

// @desc    Шинэ кино үүсгэх
// @route   POST /api/movies
// @access  Private/Admin
export const createMovie = async (req, res) => {
    try {
        console.log('createMovie request body:', req.body);

        const {
            title, originalTitle, duration, genre,
            rating, imdb, status, posterUrl,
            description, trailerUrl, releaseDate,
            cast   // ← нэмэгдлээ
        } = req.body;

        if (!title || !duration || !genre) {
            return res.status(400).json({ message: 'Нэр, үргэлжлэх хугацаа, төрөл заавал оруулах ёстой' });
        }

        const movie = await Movie.create({
            title,
            originalTitle:  originalTitle  || '',
            duration,
            genre:          Array.isArray(genre) ? genre : [genre],
            rating:         rating          || 'PG',
            imdb:           imdb            || '',
            status:         status          || 'nowShowing',
            posterUrl:      posterUrl       || '',
            description:    description     || '',
            trailerUrl:     trailerUrl      || '',
            releaseDate:    releaseDate     || null,
            cast:           Array.isArray(cast) ? cast : [],  // ← нэмэгдлээ
        });

        res.status(201).json(movie);
    } catch (error) {
        console.error('Create movie error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа', error: error.message });
    }
};

// @desc    Кино засах
// @route   PUT /api/movies/:id
// @access  Private/Admin
export const updateMovie = async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);

        if (!movie) {
            return res.status(404).json({ message: 'Кино олдсонгүй' });
        }

        const {
            title, originalTitle, duration, genre,
            rating, imdb, status, posterUrl,
            description, trailerUrl, releaseDate,
            cast  
        } = req.body;

        if (title         !== undefined) movie.title         = title;
        if (originalTitle !== undefined) movie.originalTitle = originalTitle || '';
        if (duration      !== undefined) movie.duration      = duration;
        if (genre         !== undefined) movie.genre         = Array.isArray(genre) ? genre : [genre];
        if (rating        !== undefined) movie.rating        = rating  || 'PG';
        if (imdb          !== undefined) movie.imdb          = imdb    || '';
        if (status        !== undefined) movie.status        = status  || 'nowShowing';
        if (posterUrl     !== undefined) movie.posterUrl     = posterUrl    || '';
        if (description   !== undefined) movie.description   = description  || '';
        if (trailerUrl    !== undefined) movie.trailerUrl    = trailerUrl   || '';
        if (releaseDate   !== undefined) movie.releaseDate   = releaseDate  || null;
        if (cast          !== undefined) movie.cast          = Array.isArray(cast) ? cast : [];

        await movie.save();

        res.json(movie);
    } catch (error) {
        console.error('Update movie error:', error);
        res.status(500).json({ message: 'Серверийн алдаа', error: error.message });
    }
};

// @desc    Кино устгах
// @route   DELETE /api/movies/:id
// @access  Private/Admin
export const deleteMovie = async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);

        if (!movie) {
            return res.status(404).json({ message: 'Кино олдсонгүй' });
        }

        await movie.deleteOne();
        res.json({ message: 'Кино амжилттай устгагдлаа' });
    } catch (error) {
        console.error('Delete movie error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа', error: error.message });
    }
};

// @desc    Бүх кино авах
// @route   GET /api/movies
// @access  Public
export const getMovies = async (req, res) => {
    try {
        const { status, genre, limit = 20, page = 1 } = req.query;

        const query = {};
        if (status) query.status = status;
        if (genre)  query.genre  = genre;

const movies = await Movie.find(query)
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

        const total = await Movie.countDocuments(query);

        const nowShowing = movies.filter(m => m.status === 'nowShowing');
        const comingSoon = movies.filter(m => m.status === 'comingSoon');
        const featured   = movies.find(m => m.isFeatured) || movies[0] || null;

        res.json({ nowShowing, comingSoon, featured, totalCount: total });
    } catch (error) {
        console.error('Get movies error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
    }
};

// @desc    Нэг кино авах
// @route   GET /api/movies/:id
// @access  Public
export const getMovieById = async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);

        if (!movie) {
            return res.status(404).json({ message: 'Кино олдсонгүй' });
        }

        res.json(movie);
    } catch (error) {
        console.error('Get movie by id error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
    }
};