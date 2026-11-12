const pool = require('../config/db');
const bcrypt = require('bcrypt');

// CREATE (Your existing register function, matched to your 'password' column)
const registerUser = async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const query = `
      INSERT INTO users (username, email, password)
      VALUES ($1, $2, $3)
      RETURNING id, username, email, created_at;
    `;
    const result = await pool.query(query, [username, email, hashedPassword]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username or email already exists' });
    }
    res.status(500).json({ error: 'Server error' });
  }
};

// LOGIN USER ---------------------------------------------------------------------------------------------------------

const jwt = require('jsonwebtoken');

const loginUser = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const accessToken = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    )

    await pool.query('UPDATE users SET refresh_token = $1 WHERE id = $2', [refreshToken, user.id]);

    res.cookie('jwt_refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7*24*60*60*1000 // 7 days
    })

    res.json({
      message: 'Login successful',
      accessToken,
      user: { id: user.id, username: user.username, email: user.email }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({error: 'Server error'});
  }
}

// REFRESH ACCESS TOKEN ---------------------------------------------------------------------------------------------------------
const refreshAccessToken = async (req, res) => {
  const refreshToken = req.cookies.jwt_refresh;
  if(!refreshToken) {
    return res.status(401).json({ error: 'No refresh token found' });
  }

  try{
    const decoded = jwt.verify(refreshToken, proccess.env.JWT_REFRESH_SECRET);
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.id]);
    const user = result.rows;

    if(!user || user.refresh_token !== refreshToken) {
      return res.status(403).json({ error: 'Invalid or revoked refresh token' });
    }
    const newAccessToken = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    )
    res.json({ accessToken: newAccessToken });
  }catch(err) {
    console.error(err);
    res.status(403).json({ error: 'Invalid or expired refresh token' });
  }
}

// LOGOUT USER ---------------------------------------------------------------------------------------------------------
const logoutUser = async ( req, res ) => {
  const refreshToken = req.cookies.jwt_refresh;
  if(refreshToken) {
    await pool.query('UPDATE users SET refresh_token = NULL WHERE refresh_token $1', [refreshToken]);
  }

  res.clearCookie('jwt_refresh', { httpOnly: true, sameSite: 'strict' });
  res.json({ message: 'Logged out successfully' });
}

// READ ALL USERS ---------------------------------------------------------------------------------------------------------
const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, email, created_at FROM users ORDER BY id ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// READ SINGLE USER BY ID ---------------------------------------------------------------------------------------------------------
const getUserById = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      'SELECT id, username, email, created_at FROM users WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

// UPDATE USER (Modify username, email, or password) ---------------------------------------------------------------------------------------------------------
const updateUser = async (req, res) => {
  const { id } = req.params;
  const { username, email, password } = req.body;

  if (req.user.id !== parseInt(id)){
    return res.status(403).json({ error: 'Forbidden: You can only modify your own account' });
  }

  try {
    // Hash the new password if the user provided one ---------------------------------------------------------------------------------------------------------
    let hashedPassword = null;
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // COALESCE keeps the existing database value if a field wasn't sent in req.body
    const query = `
      UPDATE users
      SET 
        username = COALESCE($1, username),
        email = COALESCE($2, email),
        password = COALESCE($3, password)
      WHERE id = $4
      RETURNING id, username, email, created_at;
    `;
    const result = await pool.query(query, [username, email, hashedPassword, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User updated', user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username or email already in use' });
    }
    res.status(500).json({ error: 'Server error' });
  }
};

// DELETE USER ---------------------------------------------------------------------------------------------------------
const deleteUser = async (req, res) => {
  const { id } = req.params;

  if (req.user.id !== parseInt(id)) {
    return res.status(403).json({ error: 'Forbidden: You can only delete your own account' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id, username',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ message: 'User deleted successfully', user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  refreshAccessToken,
  logoutUser
};
