const fs = require("fs");
const path = require("path");

/**
 * Scans a file to detect database models and tables across popular ORMs/ODMs.
 * @param {string} filePath - Absolute path to the file.
 * @returns {Array} - An array of objects containing the ORM type and Table Name.
 */
function extractDatabaseSchemas(filePath) {
  const ext = path.extname(filePath);
  let content = "";

  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch (error) {
    return [];
  }

  const schemas = [];

  // 1. Mongoose (Node.js / MongoDB)
  // Matches: mongoose.model('User', ...)
  if (content.includes("mongoose")) {
    const mongooseRegex = /mongoose\.model\s*\(\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = mongooseRegex.exec(content)) !== null) {
      schemas.push({ database_type: "Mongoose (NoSQL)", table_name: match[1] });
    }
  }

  // 2. Prisma (Universal)
  // Matches: model User { ... } inside .prisma files
  if (ext === ".prisma") {
    const prismaRegex = /model\s+([A-Za-z0-9_]+)/g;
    let match;
    while ((match = prismaRegex.exec(content)) !== null) {
      schemas.push({ database_type: "Prisma ORM", table_name: match[1] });
    }
  }

  // 3. Sequelize (Node.js / SQL)
  // Matches: sequelize.define('User', ...)
  if (content.includes("sequelize")) {
    const seqRegex = /sequelize\.define\s*\(\s*['"]([^'"]+)['"]/g;
    let match;
    while ((match = seqRegex.exec(content)) !== null) {
      schemas.push({ database_type: "Sequelize (SQL)", table_name: match[1] });
    }
  }

  // 4. TypeORM (TypeScript / SQL)
  // Matches: @Entity() followed by export class User
  if (content.includes("@Entity")) {
    const typeOrmRegex = /@Entity[\s\S]*?class\s+([A-Za-z0-9_]+)/g;
    let match;
    while ((match = typeOrmRegex.exec(content)) !== null) {
      schemas.push({ database_type: "TypeORM (SQL)", table_name: match[1] });
    }
  }

  // 5. SQLAlchemy / Django (Python)
  // Matches: class User(models.Model): or class User(Base):
  if (
    ext === ".py" &&
    (content.includes("models.Model") ||
      content.includes("Base") ||
      content.includes("db.Model"))
  ) {
    const pyRegex =
      /class\s+([A-Za-z0-9_]+)\s*\((?:models\.Model|Base|db\.Model|.*Base)\):/g;
    let match;
    while ((match = pyRegex.exec(content)) !== null) {
      schemas.push({ database_type: "Python ORM", table_name: match[1] });
    }
  }

  return schemas;
}

module.exports = extractDatabaseSchemas;
