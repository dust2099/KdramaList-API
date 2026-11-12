const express = require('express');
const router = express.Router();
const { registerUser, getAllUsers, getUserById, updateUser, deleteUser, loginUser, logoutUser, refreshAccessToken} = require('../controllers/userController');
const { protect } = require('../middleware/authMiddleware');

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/logout', logoutUser);
router.post('/refresh', refreshAccessToken);
router.get('/', getAllUsers);
router.get('/:id', getUserById);

router.put('/:id', protect, updateUser);
router.delete('/:id', protect, deleteUser);

module.exports = router;
