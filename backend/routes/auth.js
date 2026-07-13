const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db/queries");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
const TOKEN_TTL = "7d";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
}

function publicUser(user) {
  return { id: user.id, email: user.email, username: user.username };
}

// --- POST /api/auth/register ------------------------------------------
router.post("/register", async (req, res) => {
  try {
    const { email, password, username } = req.body || {};

    if (!email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: "A valid email is required." });
    }
    if (!password || password.length < 8) {
      return res
        .status(400)
        .json({ error: "Password must be at least 8 characters." });
    }

    if (db.findUserByEmail(email)) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = db.createUser({ email, passwordHash, username: username || null });

    res.status(201).json({ token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("❌ Register error:", error.message);
    res.status(500).json({ error: "Failed to create account." });
  }
});

// --- POST /api/auth/login ----------------------------------------------
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = db.findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    res.json({ token: issueToken(user), user: publicUser(user) });
  } catch (error) {
    console.error("❌ Login error:", error.message);
    res.status(500).json({ error: "Failed to log in." });
  }
});

// --- GET /api/auth/me ----------------------------------------------------
router.get("/me", requireAuth, (req, res) => {
  const user = db.findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  res.json({ user: publicUser(user) });
});

module.exports = router;
