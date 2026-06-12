import Movie from '../models/Movie.js';
import User from '../models/User.js';
import Schedule from '../models/Schedule.js';
import { sendNewMovieNotification } from '../services/Emailservice.js';

const getFrontendUrl = () => (
    process.env.FRONTEND_URL ||
    process.env.CLIENT_URL ||
    'https://khovdteatr-web-pied.vercel.app'
).replace(/\/$/, '');

const parseTicketPrice = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
};

const notifyUsersAboutNewMovie = async (movie) => {
    const users = await User.find({
        notifications: true,
        email: { $exists: true, $ne: '' },
    }).select('name email').lean();

    if (!users.length) return;

    const frontendUrl = getFrontendUrl();
    const results = await Promise.allSettled(users.map((user) =>
        sendNewMovieNotification({
            to: user.email,
            userName: user.name,
            movie,
            frontendUrl,
        })
    ));

    const sent = results.filter((result) => result.status === 'fulfilled' && result.value?.success).length;
    console.log(`[Email] New movie notifications: ${sent}/${users.length}`);
};

// @desc    Шинэ үзвэр үүсгэх
// @route   POST /api/movies
// @access  Private/Admin
export const createMovie = async (req, res) => {
  
    try {
       console.log('createMovie request body:', req.body);

        const {
            title,
            originalTitle,
            duration,
            genre,
            rating,
            imdb,
            status,
            posterUrl,
            description,
            trailerUrl,
            releaseDate,
            adultPrice,
            childPrice
        } = req.body;

        // Шаардлагатай талбаруудыг шалгах
        if (!title || !duration || !genre) {
          console.log('Missing required fields:', { title, duration, genre });
            return res.status(400).json({ message: 'Нэр, үргэлжлэх хугацаа, төрөл заавал оруулах ёстой' });
        }

        // Статусыг зөв утгад хөрвүүлэх
        let movieStatus = 'nowShowing'; // default
        if (status === 'comingSoon' || status === 'comingsoon') {
            movieStatus = 'comingSoon';
        } else if (status === 'nowShowing' || status === 'nowshowing') {
            movieStatus = 'nowShowing';
        }

        // releaseDate-г шалгах - хоосон бол null эсвэл өнөөдрийн огноо
        let movieReleaseDate = null;
        if (releaseDate && releaseDate.trim() !== '') {
            movieReleaseDate = new Date(releaseDate);
        }

        const movie = await Movie.create({
            title,
            originalTitle: originalTitle || '',
            duration,
            genre: Array.isArray(genre) ? genre : [genre],
            rating: rating || 'PG',
            imdb: imdb || '',
            status: movieStatus,
            posterUrl: posterUrl || '',
            description: description || '',
            trailerUrl: trailerUrl || '',
            releaseDate: movieReleaseDate,
            adultPrice: parseTicketPrice(adultPrice, 15000),
            childPrice: parseTicketPrice(childPrice, 10000)
        });

        console.log('Movie created successfully:', movie._id);
        notifyUsersAboutNewMovie(movie).catch((error) => {
            console.error('New movie notification error:', error.message);
        });
        res.status(201).json(movie);
    } catch (error) {
        console.error('Create movie error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа', error: error.message });
    }
};

// @desc    Үзвэр засах
// @route   PUT /api/movies/:id
// @access  Private/Admin
export const updateMovie = async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);

        if (!movie) {
            return res.status(404).json({ message: 'Үзвэр олдсонгүй' });
        }

        const {
            title,
            originalTitle,
            duration,
            genre,
            rating,
            imdb,
            status,
            posterUrl,
            description,
            trailerUrl,
            releaseDate,
            adultPrice,
            childPrice
        } = req.body;
        const schedulePriceUpdate = {};

        // Талбаруудыг шинэчлэх
        if (title !== undefined) movie.title = title;
        if (originalTitle !== undefined) movie.originalTitle = originalTitle || '';
        if (duration !== undefined) movie.duration = duration;
        if (genre !== undefined) movie.genre = Array.isArray(genre) ? genre : [genre];
        if (rating !== undefined) movie.rating = rating || 'PG';
        if (imdb !== undefined) movie.imdb = imdb || '';
        
        // Статусыг зөв утгад хөрвүүлэх
        if (status !== undefined) {
            if (status === 'comingSoon' || status === 'comingsoon') {
                movie.status = 'comingSoon';
            } else if (status === 'nowShowing' || status === 'nowshowing') {
                movie.status = 'nowShowing';
            } else if (status === 'active') {
                movie.status = 'nowShowing'; // 'active'-г 'nowShowing' болгох
            }
        }
        
        if (posterUrl !== undefined) movie.posterUrl = posterUrl || '';
        if (description !== undefined) movie.description = description || '';
        if (trailerUrl !== undefined) movie.trailerUrl = trailerUrl || '';
        if (adultPrice !== undefined) {
            const nextAdultPrice = parseTicketPrice(adultPrice, movie.adultPrice || 15000);
            movie.adultPrice = nextAdultPrice;
            schedulePriceUpdate.basePrice = nextAdultPrice;
        }
        if (childPrice !== undefined) {
            const nextChildPrice = parseTicketPrice(childPrice, movie.childPrice || 10000);
            movie.childPrice = nextChildPrice;
            schedulePriceUpdate.childPrice = nextChildPrice;
        }
        
        // releaseDate-г шалгах
        if (releaseDate !== undefined) {
            if (releaseDate && releaseDate.trim() !== '') {
                movie.releaseDate = new Date(releaseDate);
            } else {
                movie.releaseDate = null;
            }
        }

        await movie.save();

        let updatedSchedulesCount = 0;
        if (Object.keys(schedulePriceUpdate).length > 0) {
            const result = await Schedule.updateMany(
                {
                    movie: movie._id,
                    showTime: { $gte: new Date() },
                },
                { $set: schedulePriceUpdate }
            );
            updatedSchedulesCount = result.modifiedCount || 0;
        }

        res.json({
            ...movie.toObject(),
            updatedSchedulesCount,
        });
    } catch (error) {
        console.error('Update movie error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа', error: error.message });
    }
};

// @desc    Үзвэр устгах
// @route   DELETE /api/movies/:id
// @access  Private/Admin
export const deleteMovie = async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);

        if (!movie) {
            return res.status(404).json({ message: 'Үзвэр олдсонгүй' });
        }

        await movie.deleteOne();

        res.json({ message: 'Үзвэр амжилттай устгагдлаа' });
    } catch (error) {
        console.error('Delete movie error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа', error: error.message });
    }
};

// @desc    Бүх үзвэр авах
// @route   GET /api/movies
// @access  Public
export const getMovies = async (req, res) => {
    try {
        const { status, genre, limit = 20, page = 1 } = req.query;
        
        const query = {};
        if (status) query.status = status;
        if (genre) query.genre = genre;

        const movies = await Movie.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const total = await Movie.countDocuments(query);

        // Үзвэрүүдийг статусаар нь ялгах
        const nowShowing = movies.filter(m => m.status === 'nowShowing');
        const comingSoon = movies.filter(m => m.status === 'comingSoon');
        const featured = movies.find(m => m.isFeatured) || movies[0] || null;

        res.json({
            nowShowing,
            comingSoon,
            featured,
            totalCount: total
        });
    } catch (error) {
        console.error('Get movies error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
    }
};

// @desc    Нэг үзвэр авах
// @route   GET /api/movies/:id
// @access  Public
export const getMovieById = async (req, res) => {
    try {
        const movie = await Movie.findById(req.params.id);
        
        if (!movie) {
            return res.status(404).json({ message: 'Үзвэр олдсонгүй' });
        }

        res.json(movie);
    } catch (error) {
        console.error('Get movie by id error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
    }
};
