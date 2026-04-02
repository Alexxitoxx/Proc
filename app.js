const express = require("express");
const session = require("express-session");
const path = require("path");
const multer = require("multer");
const { Pool } = require("pg");
const fs = require("fs");
const createLoginRouter = require("./Login/APIs");
const createAdminRouter = require("./Admin/routes");
const createVendedorRouter = require("./Vendedor/CRUD");
const createVendedorOrdersRouter = require("./Vendedor/Pedidos");
const createCompradorRouter = require("./Comprador/productos");
const createCompradorCuentaRouter = require("./Comprador/cuenta");
const createCompradorCarritoRouter = require("./Comprador/carrito");


const app = express();

// Configuración
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("static"));

app.use(
  session({
    secret: "clave_super_secreta",
    resave: false,
    saveUninitialized: true,
  })
);

// PostgreSQL conexión
const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "senora_chela",
  password: "password",
  port: 5432,
});

// Carpeta de imágenes
const uploadFolder = "static/images/products";

if (!fs.existsSync(uploadFolder)) {
  fs.mkdirSync(uploadFolder, { recursive: true });
}

// Configuración de subida de imágenes
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadFolder);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// Obtener productos
async function obtenerProductos() {
  const result = await pool.query("SELECT * FROM Productos");
  return result.rows;
}

// Obtener categorías
async function obtenerCategorias() {
  const result = await pool.query(
    "SELECT DISTINCT categoria FROM Productos"
  );
  return result.rows.map((c) => c.categoria);
}

app.use(
  createLoginRouter({
    pool,
  })
);

app.use(
  createAdminRouter({
    pool,
    upload,
    obtenerProductos,
  })
);

app.use(
  createCompradorRouter({
    pool,
  })
);

app.use(
  createCompradorCuentaRouter({
    pool,
  })
);

app.use(
  createCompradorCarritoRouter({
    pool,
  })
);

app.use(
  createVendedorRouter({
    pool,
    obtenerProductos,
    obtenerCategorias,
  })
);

app.use(
  createVendedorOrdersRouter({
    pool,
  })
);

app.listen(3000, () => {
  console.log("Servidor corriendo en puerto 3000");
});