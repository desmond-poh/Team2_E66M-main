const express    = require('express');
const mysql      = require('mysql2');
const session    = require('express-session');
const flash      = require('connect-flash');
const multer     = require('multer');
const path       = require('path');

const app = express();

// Set up multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images'); // Directory to save uploaded files
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname); 
    }
});
//test
const upload = multer({ storage: storage });

// ---------- DB ----------
const db = mysql.createConnection({
  host:     's5cgqf.h.filess.io',
  port:     3307,
  user:     'LITMEMORIES_lifememory',
  password: 'Team2_LITMemories',
  database: 'LITMEMORIES_lifememory'
});
db.connect(err => {
  if (err) throw err;
  console.log('Connected to database');
});

// ---------- Middleware ----------
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 } // 1 week
}));
app.use(flash());
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.locals.messages = req.flash('success');
  res.locals.errors   = req.flash('error');
  res.locals.user     = req.session.user || null;
  next();
});

app.set('view engine', 'ejs');

// ---------- Helpers ----------
const checkAuthenticated = (req, res, next) => {
  if (req.session.user) return next();
  req.flash('error', 'Please log in to view this resource');
  res.redirect('/login');
};

const checkAdmin = (req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') return next();
  req.flash('error', 'Access denied');
  res.redirect('/dashboard');
};

const validateRegistration = (req, res, next) => {
  const { username, email, password, contact } = req.body;
  if (!username || !email || !password || !contact) {
    req.flash('error', 'All fields are required.');
    req.flash('formData', req.body);
    return res.redirect('/register');
  }
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\W_]).{6,}$/;
  if (!passwordRegex.test(password)) {
    req.flash('error', 'Password must be at least 6 characters long and include at least 1 uppercase letter, 1 lowercase letter, and 1 symbol.');
    req.flash('formData', req.body);
    return res.redirect('/register');
  }
  next();
};

// ---------- Routes ----------

// Home
app.get('/', (req, res) => {
  res.render('index', { user: req.session.user, messages: req.flash('success') });
});

// Register
app.get('/register', (req, res) => {
  res.render('register', {
    messages: req.flash('error'),
    formData: req.flash('formData')[0]
  });
});
app.post('/register', validateRegistration, (req, res) => {
  const { username, email, password, contact, role } = req.body;
  const sql = 'INSERT INTO users (username, email, password, contact, role) VALUES (?, ?, SHA1(?), ?, ?)';
  db.query(sql, [username, email, password, contact, role], err => {
    if (err) {
      req.flash('error', 'Registration failed. Please try again.');
      return res.redirect('/register');
    }
    req.flash('success', 'Registration successful! Please log in.');
    res.redirect('/login');
  });
});

// Login
app.get('/login', (req, res) => {
  res.render('login', {
    messages: req.flash('success'),
  });
});
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    req.flash('error', 'All fields are required.');
    return res.redirect('/login');
  }
  const sql = `
    SELECT userId, username, role
    FROM users
    WHERE email = ? AND password = SHA1(?)
  `;
  db.query(sql, [email, password], (err, rows) => {
    if (err) {
      req.flash('error', 'An error occurred.');
      return res.redirect('/login');
    }
    if (!rows.length) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/login');
    }
    req.session.user = {  
      userId:   rows[0].userId,
      username: rows[0].username,
      role:     rows[0].role
    };
    req.flash('success', 'Login successful!');
    res.redirect(rows[0].role === 'admin' ? '/admin' : '/dashboard');
  });
});

// Dashboard – conditional: admin sees all, others see only their own
app.get('/dashboard', checkAuthenticated, (req, res) => {
  const q = req.query.search || '';
  let sql = 'SELECT m.imageId, m.imageName, DATE_FORMAT(m.`date`, "%Y-%m-%d") AS date, m.description, m.image';
  const params = [];

  if (req.session.user.role === 'admin') {
    sql += ', u.username FROM memories m JOIN users u ON m.userId = u.userId';
  } else {
    sql += ' FROM memories m';
  }

  const where = [];
  if (req.session.user.role !== 'admin') {
    where.push('m.userId = ?');
    params.push(req.session.user.userId);
  }
  if (q) {
    where.push('(m.imageName LIKE ? OR m.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');

  sql += ' ORDER BY m.`date` DESC';

  db.query(sql, params, (err, results) => {
    if (err) {
      console.error('Database query error:', err);
      return res.status(500).send('Error retrieving memories');
    }
    res.render('dashboard', {
      user:     req.session.user,
      memories: results,
      search:   q
    });
  });
});


// Admin dashboard
app.get('/admin', checkAuthenticated, checkAdmin, (req, res) => {
  const search = req.query.search || ""; // add this line!
  let sql = `
    SELECT m.imageId, m.imageName, m.date, m.description, m.image,
           u.username, u.role
    FROM memories m
    JOIN users u ON m.userId = u.userId
  `;
  let params = [];
  if (search) {
    sql += " WHERE m.imageName LIKE ? OR m.description LIKE ? OR u.username LIKE ?";
    params = [`%${search}%`, `%${search}%`, `%${search}%`];
  }
  sql += " ORDER BY m.date DESC";
  db.query(sql, params, (err, memories) => {
    if (err) {
      console.error('Admin dashboard error:', err);
      return res.status(500).send('Error loading admin dashboard');
    }
    res.render('admin', { user: req.session.user, memories, search }); // pass search!
  });
});


// Admin - View all memories
app.get('/admin/memories', checkAuthenticated, checkAdmin, (req, res) => {
  const sql = `
    SELECT memories.*, users.username
    FROM memories
    LEFT JOIN users ON memories.userId = users.userId
    ORDER BY date DESC
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error('Admin list error:', err);
      return res.status(500).send('Error retrieving all memories');
    }
    res.render('adminMemories', { memories: results, user: req.session.user });
  });
});

// Single memory view
app.get('/memories/:imageId', checkAuthenticated, (req, res) => {
  db.query('SELECT * FROM memories WHERE imageId = ?', [req.params.imageId], (err, results) => {
    if (err) return res.status(500).send('Error retrieving memory by ID');
    if (!results.length) return res.status(404).send('Memory not found');
    res.render('memory', { memory: results[0] });
  });
});

// Add memory
app.get('/addMemories', checkAuthenticated, (req, res) => {
  res.render('addMemories');
});
app.post('/addMemories', checkAuthenticated, upload.single('image'), (req, res) => {
  const { imageName, date, description } = req.body;
  const userId = req.session.user.userId;
  const imageUrl = req.file ? '/images/' + req.file.filename : null;

  if (!imageName || !date) {
    req.flash('error', 'Title and date are required.');
    return res.redirect('/addMemories');
  }

  const sql = `
    INSERT INTO memories (imageName, date, description, image, userId)
    VALUES (?, ?, ?, ?, ?)
  `;
  db.query(sql, [imageName, date, description || null, imageUrl, userId], err => {
    if (err) {
      console.error('Add Memory error:', err);
      req.flash('error', 'Could not save memory.');
      return res.redirect('/addMemories');
    }
    req.flash('success', 'Memory added!');
    res.redirect('/dashboard');
  });
});

// Edit memory form
app.get('/editmemories/:imageId', checkAuthenticated, (req, res) => {
  db.query(
    `SELECT imageId,
            imageName,
            DATE_FORMAT(` + "`date`" + `, '%Y-%m-%d') AS date,
            description,
            image
     FROM memories
     WHERE imageId = ?`,
    [req.params.imageId],
    (err, results) => {
      if (err) return res.status(500).send('Server error');
      if (!results.length) return res.status(404).send('Memory not found');
      res.render('editmemories', { memory: results[0] });
    }
  );
});

// Edit memory submit
app.post('/editmemories/:imageId', checkAuthenticated, upload.single('image'), (req, res) => {
  const { imageId } = req.params;
  const { imageName, description, date, currentImage } = req.body;
  let image = currentImage;
  if (req.file) {
    image = '/images/' + req.file.filename;
  }

  const sql = `
    UPDATE memories
    SET imageName = ?, description = ?, date = ?, image = ?
    WHERE imageId = ?
  `;
  db.query(sql, [imageName, description, date, image, imageId], err => {
    if (err) {
      console.error('Error updating memory:', err);
      req.flash('error', 'Update failed');
      return res.redirect('/editmemories/' + imageId);
    }
    req.flash('success', 'Memory updated!');
    res.redirect('/dashboard');
  });
});

// Delete memory confirmation
app.get('/deletememory/:imageId', checkAuthenticated, (req, res) => {
  db.query('SELECT * FROM memories WHERE imageId = ?', [req.params.imageId], (err, results) => {
    if (err) return res.status(500).send('Error retrieving memory for deletion');
    if (!results.length) return res.status(404).send('Memory not found');
    res.render('deleteMemories', { memory: results[0] });
  });
});

// Delete memory submit
app.post('/deletememory/:imageId', checkAuthenticated, (req, res) => {
  db.query('DELETE FROM memories WHERE imageId = ?', [req.params.imageId], err => {
    if (err) {
      console.error('Delete error:', err);
      return res.status(500).send('Error deleting memory');
    }
    req.flash('success', 'Memory deleted successfully!');
    if (req.session.user.role === 'admin') {
      return res.redirect('/admin');}
    else if (req.session.user.role === 'user') {
      return res.redirect('/dashboard');}
  });
});
  
// Admin deletes any memory
app.post('/admin/memories/delete/:imageId', checkAuthenticated, checkAdmin, (req, res) => {
  db.query('DELETE FROM memories WHERE imageId = ?', [req.params.imageId], err => {
    if (err) {
      console.error('Admin delete error:', err);
      return res.status(500).send('Error deleting memory');
    }
    req.flash('success', 'Memory deleted by admin.');
    res.redirect('/admin/memories');
  });
});


// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ---------- Start Server ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
