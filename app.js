const express = require("express");
const session = require("express-session");
const { Pool } = require("pg");
const createLoginRouter = require("./Login/APIs");
const createAdminRouter = require("./Admin/routes");
const createVendedorRouter = require("./Vendedor/CRUD");
const createVendedorOrdersRouter = require("./Vendedor/Pedidos");
const createVendedorBusinessRouter = require("./Vendedor/Negocio");
const createCompradorRouter = require("./Comprador/productos");
const createCompradorCuentaRouter = require("./Usuario/cuenta");
const createUsuarioWishlistRouter = require("./Usuario/wishlist");
const createCompradorCarritoRouter = require("./Comprador/carrito");
const createCompradorPedidosRouter = require("./Comprador/pedidos");
const createIARouter = require("./IA/routes");


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


app.use(
  createLoginRouter({
    pool,
  })
);

app.use(
  createAdminRouter({
    pool,
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
  createUsuarioWishlistRouter({
    pool,
  })
);

app.use(
  createCompradorCarritoRouter({
    pool,
  })
);

app.use(
  createCompradorPedidosRouter({
    pool,
  })
);

app.use(
  createIARouter()
);

app.use(
  createVendedorRouter({
    pool,
  })
);

app.use(
  createVendedorOrdersRouter({
    pool,
  })
);

app.use(
  createVendedorBusinessRouter({
    pool,
  })
);

app.listen(3000, () => {
  console.log("Servidor corriendo en puerto 3000");
});