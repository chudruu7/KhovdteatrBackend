// src/controllers/cinemaInfoController.js

import CinemaInfo from '../models/CinemaInfo.js';

// @desc    Байгууллагын мэдээлэл авах
// @route   GET /api/cinema-info
// @access  Public
export const getCinemaInfo = async (req, res) => {
    try {
        let info = await CinemaInfo.findOne();
        
        // Хэрэв мэдээлэл байхгүй бол анхны өгөгдөл үүсгэх
        if (!info) {
            info = await CinemaInfo.create({
                name: 'Cinema Pro',
                address: 'СБД, 1-р хороо, Энхтайваны өргөн чөлөө, Улаанбаатар хот',
                phone: '+976 7000-1122',
                email: 'info@cinemapro.mn',
                website: 'www.cinemapro.mn',
                socialMedia: {
                    facebook: 'cinemapro.mn',
                    instagram: 'cinemapro_mn',
                    twitter: 'cinemapro'
                },
                workingHours: {
                    monday: '10:00 - 23:00',
                    tuesday: '10:00 - 23:00',
                    wednesday: '10:00 - 23:00',
                    thursday: '10:00 - 23:00',
                    friday: '10:00 - 00:00',
                    saturday: '09:00 - 00:00',
                    sunday: '09:00 - 23:00'
                },
                halls: [
                    { name: 'IMAX', seats: 60, type: 'IMAX Laser', price: '₮ 20,000' },
                    { name: '4DX', seats: 45, type: '4DX Motion', price: '₮ 18,000' },
                    { name: 'Grand Hall A', seats: 120, type: 'Standard', price: '₮ 15,000' },
                    { name: 'Grand Hall B', seats: 120, type: 'Standard', price: '₮ 15,000' }
                ],
                aboutUs: 'Монголын хамгийн том кино театр',
                termsAndConditions: 'Үйлчилгээний нөхцөл...',
                privacyPolicy: 'Нууцлалын бодлого...'
            });
        }

        res.json(info);

    } catch (error) {
        console.error('Get cinema info error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
    }
};

// @desc    Байгууллагын мэдээлэл шинэчлэх
// @route   PUT /api/cinema-info
// @access  Private/Admin
export const updateCinemaInfo = async (req, res) => {
    try {
        const {
            name,
            address,
            phone,
            email,
            website,
            socialMedia,
            workingHours,
            halls,
            aboutUs,
            termsAndConditions,
            privacyPolicy
        } = req.body;

        let info = await CinemaInfo.findOne();

        if (!info) {
            info = new CinemaInfo();
        }

        // Талбаруудыг шинэчлэх (зөвхөн ирсэн өгөгдлийг)
        if (name) info.name = name;
        if (address) info.address = address;
        if (phone) info.phone = phone;
        if (email) info.email = email;
        if (website !== undefined) info.website = website;
        if (socialMedia) info.socialMedia = { ...info.socialMedia, ...socialMedia };
        if (workingHours) info.workingHours = { ...info.workingHours, ...workingHours };
        if (halls) info.halls = halls;
        if (aboutUs !== undefined) info.aboutUs = aboutUs;
        if (termsAndConditions !== undefined) info.termsAndConditions = termsAndConditions;
        if (privacyPolicy !== undefined) info.privacyPolicy = privacyPolicy;

        await info.save();

        res.json(info);

    } catch (error) {
        console.error('Update cinema info error:', error);
        res.status(500).json({ message: 'Серверийн алдаа гарлаа' });
    }
};