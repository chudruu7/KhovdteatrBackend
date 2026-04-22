// src/controllers/newsController.js

import News from '../models/News.js';

// @desc    Бүх мэдээ авах
// @route   GET /api/news
// @access  Public
export const getNews = async (req, res) => {
    try {
        const { status, category, limit = 10, page = 1 } = req.query;
        
        const query = {};
        if (status) query.status = status;
        if (category) query.category = category;

        const news = await News.find(query)
            .populate('author', 'name')
            .sort({ publishedAt: -1, createdAt: -1 })
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const total = await News.countDocuments(query);

        res.json({
            news,
            page: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit)),
            total
        });

    } catch (error) {
        console.error('Get news error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
    }
};

// @desc    Нэг мэдээ авах
// @route   GET /api/news/:id
// @access  Public
export const getNewsById = async (req, res) => {
    try {
        const news = await News.findById(req.params.id).populate('author', 'name');
        
        if (!news) {
            return res.status(404).json({ message: 'Мэдээ олдсонгүй' });
        }

        // Үзсэн тоог нэмэгдүүлэх
        news.views += 1;
        await news.save();

        res.json(news);

    } catch (error) {
        console.error('Get news by id error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
    }
};

// @desc    Шинэ мэдээ үүсгэх
// @route   POST /api/news
// @access  Private/Admin
export const createNews = async (req, res) => {
    try {
        const { title, excerpt, content, image, category, status } = req.body;

        // Шаардлагатай талбаруудыг шалгах
        if (!title || !excerpt || !content || !category) {
            return res.status(400).json({ message: 'Гарчиг, товч агуулга, дэлгэрэнгүй, төрөл заавал оруулах ёстой' });
        }

        const news = await News.create({
            title,
            excerpt,
            content,
            image: image || null,
            author: req.user._id,
            category,
            status: status || 'draft',
            publishedAt: status === 'published' ? new Date() : null
        });

        const populatedNews = await News.findById(news._id).populate('author', 'name');

        res.status(201).json(populatedNews);

    } catch (error) {
        console.error('Create news error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
    }
};

// @desc    Мэдээ засах
// @route   PUT /api/news/:id
// @access  Private/Admin
export const updateNews = async (req, res) => {
    try {
        const news = await News.findById(req.params.id);

        if (!news) {
            return res.status(404).json({ message: 'Мэдээ олдсонгүй' });
        }

        const { title, excerpt, content, image, category, status } = req.body;

        // Талбаруудыг шинэчлэх
        if (title) news.title = title;
        if (excerpt) news.excerpt = excerpt;
        if (content) news.content = content;
        if (image !== undefined) news.image = image;
        if (category) news.category = category;
        
        // Статус өөрчлөгдсөн бол publishedAt-г шинэчлэх
        if (status && status !== news.status) {
            news.status = status;
            if (status === 'published' && !news.publishedAt) {
                news.publishedAt = new Date();
            }
        }

        await news.save();

        const populatedNews = await News.findById(news._id).populate('author', 'name');

        res.json(populatedNews);

    } catch (error) {
        console.error('Update news error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
    }
};

// @desc    Мэдээ устгах
// @route   DELETE /api/news/:id
// @access  Private/Admin
export const deleteNews = async (req, res) => {
    try {
        const news = await News.findById(req.params.id);

        if (!news) {
            return res.status(404).json({ message: 'Мэдээ олдсонгүй' });
        }

        await news.deleteOne();

        res.json({ message: 'Мэдээ амжилттай устгагдлаа' });

    } catch (error) {
        console.error('Delete news error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
    }
};