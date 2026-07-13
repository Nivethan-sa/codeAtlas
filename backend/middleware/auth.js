const jwt = require("jsonwebtoken");
const db = require("../db/queries");

const JWT_SECRET = process.env.JWT_SECRET;

function readToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme === "Bearer" && token) return token;
  return null;
}

/**
 * Attaches req.user if a valid token is present, but never blocks the
 * request otherwise. CodeAtlas lets anyone run a scan; being logged in
 * just means the scan gets attributed to your account so it shows up
 * in "My Scans" instead of the anonymous public feed.
 */
function optionalAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return next();

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // The JWT's signature being valid only proves it was issued by us at
    // some point in its 7-day lifetime - it doesn't prove the user row it
    // points at still exists (e.g. the DB was reset/reseeded, or the
    // account was otherwise removed, while the token was still unexpired).
    // Attaching a dangling id here would later blow up as a FOREIGN KEY
    // constraint failure when that id is written to scans.user_id, so we
    // confirm the user is real before treating the request as authed.
    const user = db.findUserById(payload.sub);
    if (user) {
      req.user = { id: user.id, email: user.email };
    }
  } catch (error) {
    // Invalid/expired token - treat the request as anonymous instead
    // of erroring, since auth here is additive, not load-bearing.
  }
  next();
}

/**
 * Hard-blocks the request unless a valid token is present. Used for
 * account-scoped actions like deleting a scan.
 */
function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: "Authentication required." });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.findUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ error: "Invalid or expired session." });
    }
    req.user = { id: user.id, email: user.email };
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired session." });
  }
}

module.exports = { optionalAuth, requireAuth };
