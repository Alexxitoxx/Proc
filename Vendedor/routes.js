const express = require("express");

function createVendedorRouter({ pool, obtenerProductos, obtenerCategorias }) {
  const router = express.Router();

  // Vista cliente
  router.get("/cliente", async (req, res) => {
    if (req.session.usuario && req.session.rol === "cliente") {
      const productos = await obtenerProductos();
      const categorias = await obtenerCategorias();
      return res.json({ productos, categorias });
    }

    res.redirect("/");
  });

  // Pagar
  router.post("/pagar", async (req, res) => {
    try {
      if (!req.session.usuario) {
        return res.status(401).json({ mensaje: "No has iniciado sesión" });
      }

      const carrito = req.body.carrito;

      const usuario = await pool.query("SELECT id FROM Usuario WHERE nombre_usuario=$1", [
        req.session.usuario,
      ]);

      const usuario_id = usuario.rows[0].id;

      const venta = await pool.query(
        "INSERT INTO Ventas (id_usuario) VALUES ($1) RETURNING id",
        [usuario_id]
      );

      const venta_id = venta.rows[0].id;
      let total = 0;

      for (const producto of carrito) {
        const result = await pool.query(
          "SELECT id,precio,stock FROM Productos WHERE LOWER(nombre_producto)=LOWER($1)",
          [producto.nombre]
        );

        const prod = result.rows[0];

        if (prod.stock < producto.cantidad) {
          return res.json({ mensaje: "Stock insuficiente" });
        }

        await pool.query("UPDATE Productos SET stock = stock - $1 WHERE id=$2", [
          producto.cantidad,
          prod.id,
        ]);

        const subtotal = prod.precio * producto.cantidad;
        total += subtotal;

        await pool.query(
          `INSERT INTO DetalleVenta
          (id_venta,id_producto,cantidad,subtotal)
          VALUES ($1,$2,$3,$4)`,
          [venta_id, prod.id, producto.cantidad, subtotal]
        );
      }

      await pool.query("UPDATE Ventas SET total=$1 WHERE id=$2", [total, venta_id]);

      res.json({ mensaje: "Compra registrada correctamente" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ mensaje: "Error al registrar compra" });
    }
  });

  return router;
}

module.exports = createVendedorRouter;
