const express = require("express");

function createVendedorRouter({ pool }) {
  const router = express.Router();

  // READ
  router.get("/api/vendedor/productos/:id_negocio", async (req, res) => {
    const idNegocio = Number(req.params.id_negocio);

    if (!Number.isInteger(idNegocio) || idNegocio <= 0) {
      return res.status(400).json({ error: "id_negocio invalido" });
    }

    try {
      const result = await pool.query(
        `SELECT id, id_negocio, nombre, descripcion, precio, stock_total, sku, esta_activo, fecha_registro
         FROM productos
         WHERE id_negocio = $1
         ORDER BY id DESC`,
        [idNegocio]
      );

      return res.status(200).json(result.rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al obtener productos" });
    }
  });

  // CREATE
  router.post("/api/vendedor/productos", async (req, res) => {
    const { nombre, descripcion, precio, id_negocio, sku } = req.body;
    const idNegocio = Number(id_negocio);
    const precioNum = Number(precio);

    if (!nombre || !Number.isFinite(precioNum) || !Number.isInteger(idNegocio) || idNegocio <= 0) {
      return res.status(400).json({ error: "Datos incompletos o invalidos" });
    }

    try {
      const negocio = await pool.query("SELECT id FROM negocios WHERE id = $1 LIMIT 1", [idNegocio]);
      if (negocio.rows.length === 0) {
        return res.status(404).json({ error: "Negocio no encontrado" });
      }

      const result = await pool.query(
        `INSERT INTO productos (nombre, descripcion, precio, id_negocio, sku)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, id_negocio, nombre, descripcion, precio, stock_total, sku, esta_activo, fecha_registro`,
        [String(nombre).trim(), descripcion ? String(descripcion).trim() : null, precioNum, idNegocio, sku || null]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "SKU duplicado" });
      }

      console.error(err);
      return res.status(500).json({ error: "Error al crear producto" });
    }
  });

  // UPDATE
  router.put("/api/vendedor/productos/:id", async (req, res) => {
    const idProducto = Number(req.params.id);
    const { nombre, descripcion, precio, sku, esta_activo } = req.body;

    if (!Number.isInteger(idProducto) || idProducto <= 0) {
      return res.status(400).json({ error: "id invalido" });
    }

    if (!nombre || !Number.isFinite(Number(precio))) {
      return res.status(400).json({ error: "Nombre y precio son obligatorios" });
    }

    const activo =
      esta_activo === undefined || esta_activo === null ? true : Boolean(esta_activo);

    try {
      const result = await pool.query(
        `UPDATE productos
         SET nombre = $1,
             descripcion = $2,
             precio = $3,
             sku = $4,
             esta_activo = $5
         WHERE id = $6
         RETURNING id, id_negocio, nombre, descripcion, precio, stock_total, sku, esta_activo, fecha_registro`,
        [
          String(nombre).trim(),
          descripcion ? String(descripcion).trim() : null,
          Number(precio),
          sku || null,
          activo,
          idProducto,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      return res.status(200).json(result.rows[0]);
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "SKU duplicado" });
      }

      console.error(err);
      return res.status(500).json({ error: "Error al actualizar producto" });
    }
  });

  // DELETE (soft delete)
  router.delete("/api/vendedor/productos/:id", async (req, res) => {
    const idProducto = Number(req.params.id);

    if (!Number.isInteger(idProducto) || idProducto <= 0) {
      return res.status(400).json({ error: "id invalido" });
    }

    try {
      const result = await pool.query(
        `UPDATE productos
         SET esta_activo = FALSE
         WHERE id = $1
         RETURNING id`,
        [idProducto]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      return res.status(200).json({ message: "Producto eliminado" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al eliminar producto" });
    }
  });

  // READ
  router.get("/api/vendedor/servicios/:id_negocio", async (req, res) => {
    const idNegocio = Number(req.params.id_negocio);

    if (!Number.isInteger(idNegocio) || idNegocio <= 0) {
      return res.status(400).json({ error: "id_negocio invalido" });
    }

    try {
      const result = await pool.query(
        `SELECT id, id_negocio, nombre, descripcion, precio_base, duracion_minutos, calificacion, esta_activo, fecha_registro
         FROM servicios
         WHERE id_negocio = $1
         ORDER BY id DESC`,
        [idNegocio]
      );

      return res.status(200).json(result.rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al obtener servicios" });
    }
  });

  // CREATE
  router.post("/api/vendedor/servicios", async (req, res) => {
    const { nombre, descripcion, precio_base, duracion_minutos, id_negocio } = req.body;
    const idNegocio = Number(id_negocio);
    const precioBaseNum = Number(precio_base);
    const duracionNum =
      duracion_minutos === undefined || duracion_minutos === null || duracion_minutos === ""
        ? null
        : Number(duracion_minutos);

    if (!nombre || !Number.isFinite(precioBaseNum) || !Number.isInteger(idNegocio) || idNegocio <= 0) {
      return res.status(400).json({ error: "Datos incompletos o invalidos" });
    }

    if (duracionNum !== null && (!Number.isInteger(duracionNum) || duracionNum <= 0)) {
      return res.status(400).json({ error: "duracion_minutos invalido" });
    }

    try {
      const negocio = await pool.query("SELECT id FROM negocios WHERE id = $1 LIMIT 1", [idNegocio]);
      if (negocio.rows.length === 0) {
        return res.status(404).json({ error: "Negocio no encontrado" });
      }

      const result = await pool.query(
        `INSERT INTO servicios (nombre, descripcion, precio_base, duracion_minutos, id_negocio)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, id_negocio, nombre, descripcion, precio_base, duracion_minutos, calificacion, esta_activo, fecha_registro`,
        [
          String(nombre).trim(),
          descripcion ? String(descripcion).trim() : null,
          precioBaseNum,
          duracionNum,
          idNegocio,
        ]
      );

      return res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al crear servicio" });
    }
  });

  // UPDATE
  router.put("/api/vendedor/servicios/:id", async (req, res) => {
    const idServicio = Number(req.params.id);
    const { nombre, descripcion, precio_base, duracion_minutos, esta_activo } = req.body;
    const precioBaseNum = Number(precio_base);
    const duracionNum =
      duracion_minutos === undefined || duracion_minutos === null || duracion_minutos === ""
        ? null
        : Number(duracion_minutos);

    if (!Number.isInteger(idServicio) || idServicio <= 0) {
      return res.status(400).json({ error: "id invalido" });
    }

    if (!nombre || !Number.isFinite(precioBaseNum)) {
      return res.status(400).json({ error: "Nombre y precio_base son obligatorios" });
    }

    if (duracionNum !== null && (!Number.isInteger(duracionNum) || duracionNum <= 0)) {
      return res.status(400).json({ error: "duracion_minutos invalido" });
    }

    const activo =
      esta_activo === undefined || esta_activo === null ? true : Boolean(esta_activo);

    try {
      const result = await pool.query(
        `UPDATE servicios
         SET nombre = $1,
             descripcion = $2,
             precio_base = $3,
             duracion_minutos = $4,
             esta_activo = $5
         WHERE id = $6
         RETURNING id, id_negocio, nombre, descripcion, precio_base, duracion_minutos, calificacion, esta_activo, fecha_registro`,
        [
          String(nombre).trim(),
          descripcion ? String(descripcion).trim() : null,
          precioBaseNum,
          duracionNum,
          activo,
          idServicio,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Servicio no encontrado" });
      }

      return res.status(200).json(result.rows[0]);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al actualizar servicio" });
    }
  });

  // DELETE (soft delete)
  router.delete("/api/vendedor/servicios/:id", async (req, res) => {
    const idServicio = Number(req.params.id);

    if (!Number.isInteger(idServicio) || idServicio <= 0) {
      return res.status(400).json({ error: "id invalido" });
    }

    try {
      const result = await pool.query(
        `UPDATE servicios
         SET esta_activo = FALSE
         WHERE id = $1
         RETURNING id`,
        [idServicio]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Servicio no encontrado" });
      }

      return res.status(200).json({ message: "Servicio eliminado" });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al eliminar servicio" });
    }
  });

  return router;
}

module.exports = createVendedorRouter;
