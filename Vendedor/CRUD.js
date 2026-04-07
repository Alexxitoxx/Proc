const express = require("express");

function createVendedorRouter({ pool }) {
  const router = express.Router();

  function normalizarCategoriasEntrada(rawCategorias) {
    if (!Array.isArray(rawCategorias)) {
      return null;
    }

    return [...new Set(rawCategorias.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  }

  router.post("/api/vendedor/categorias", async (req, res) => {
    try {
      const { nombre_categoria, descripcion, icon_url, tipo } = req.body;
      const nombre = String(nombre_categoria || "").trim();
      const tipoNormalizado = String(tipo || "").trim().toLowerCase();
      const descripcionFinal =
        descripcion === undefined || descripcion === null || String(descripcion).trim() === ""
          ? null
          : String(descripcion).trim();
      const iconUrlFinal =
        icon_url === undefined || icon_url === null || String(icon_url).trim() === ""
          ? null
          : String(icon_url).trim();

      if (!nombre) {
        return res.status(400).json({ error: "nombre_categoria es obligatorio" });
      }

      if (!tipoNormalizado || !["producto", "servicio", "ambos"].includes(tipoNormalizado)) {
        return res.status(400).json({ error: "tipo invalido. Usa producto, servicio o ambos" });
      }

      const result = await pool.query(
        `INSERT INTO categorias (nombre_categoria, descripcion, icon_url, tipo)
         VALUES ($1, $2, $3, $4)
         RETURNING id, nombre_categoria, descripcion, icon_url, tipo`,
        [nombre, descripcionFinal, iconUrlFinal, tipoNormalizado]
      );

      return res.status(201).json({
        mensaje: "Categoria creada correctamente",
        categoria: result.rows[0],
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "La categoria ya existe para ese tipo" });
      }

      console.error(error);
      return res.status(500).json({ error: "Error al crear categoria" });
    }
  });

  router.get("/api/vendedor/categorias", async (req, res) => {
    try {
      const tipo =
        req.query?.tipo !== undefined && req.query?.tipo !== null && String(req.query.tipo).trim() !== ""
          ? String(req.query.tipo).trim().toLowerCase()
          : null;

      if (tipo !== null && !["producto", "servicio", "ambos"].includes(tipo)) {
        return res.status(400).json({ error: "tipo invalido. Usa producto, servicio o ambos" });
      }

      const filtros = [];
      const valores = [];

      if (tipo === "producto") {
        filtros.push("tipo IN ('producto', 'ambos')");
      } else if (tipo === "servicio") {
        filtros.push("tipo IN ('servicio', 'ambos')");
      } else if (tipo === "ambos") {
        filtros.push("tipo = 'ambos'");
      }

      const whereClause = filtros.length > 0 ? `WHERE ${filtros.join(" AND ")}` : "";

      const result = await pool.query(
        `SELECT id, nombre_categoria
         FROM categorias
         ${whereClause}
         ORDER BY nombre_categoria ASC`,
        valores
      );

      return res.status(200).json(result.rows);
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error al obtener categorias" });
    }
  });

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

  router.put("/api/vendedor/productos/:id/categorias", async (req, res) => {
    const idProducto = Number(req.params.id);
    const categorias = normalizarCategoriasEntrada(req.body?.id_categorias);

    if (!Number.isInteger(idProducto) || idProducto <= 0) {
      return res.status(400).json({ error: "id de producto invalido" });
    }

    if (categorias === null) {
      return res.status(400).json({ error: "id_categorias debe ser un arreglo" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const producto = await client.query("SELECT id FROM productos WHERE id = $1 LIMIT 1", [idProducto]);
      if (producto.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      if (categorias.length > 0) {
        const categoriasValidas = await client.query(
          `SELECT id
           FROM categorias
           WHERE id = ANY($1::int[])
             AND tipo IN ('producto', 'ambos')`,
          [categorias]
        );

        if (categoriasValidas.rows.length !== categorias.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Una o mas categorias no aplican para producto" });
        }
      }

      await client.query("DELETE FROM producto_categoria WHERE id_producto = $1", [idProducto]);

      if (categorias.length > 0) {
        await client.query(
          `INSERT INTO producto_categoria (id_producto, id_categoria)
           SELECT $1, UNNEST($2::int[])`,
          [idProducto, categorias]
        );
      }

      const asignadas = await client.query(
        `SELECT c.id, c.nombre_categoria, c.tipo
         FROM producto_categoria pc
         INNER JOIN categorias c ON c.id = pc.id_categoria
         WHERE pc.id_producto = $1
         ORDER BY c.nombre_categoria ASC`,
        [idProducto]
      );

      await client.query("COMMIT");

      return res.status(200).json({
        mensaje: "Categorias de producto actualizadas",
        id_producto: idProducto,
        total_categorias: asignadas.rows.length,
        categorias: asignadas.rows,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);
      return res.status(500).json({ error: "Error al asociar categorias al producto" });
    } finally {
      client.release();
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

  router.put("/api/vendedor/servicios/:id/categorias", async (req, res) => {
    const idServicio = Number(req.params.id);
    const categorias = normalizarCategoriasEntrada(req.body?.id_categorias);

    if (!Number.isInteger(idServicio) || idServicio <= 0) {
      return res.status(400).json({ error: "id de servicio invalido" });
    }

    if (categorias === null) {
      return res.status(400).json({ error: "id_categorias debe ser un arreglo" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const servicio = await client.query("SELECT id FROM servicios WHERE id = $1 LIMIT 1", [idServicio]);
      if (servicio.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Servicio no encontrado" });
      }

      if (categorias.length > 0) {
        const categoriasValidas = await client.query(
          `SELECT id
           FROM categorias
           WHERE id = ANY($1::int[])
             AND tipo IN ('servicio', 'ambos')`,
          [categorias]
        );

        if (categoriasValidas.rows.length !== categorias.length) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "Una o mas categorias no aplican para servicio" });
        }
      }

      await client.query("DELETE FROM servicio_categoria WHERE id_servicio = $1", [idServicio]);

      if (categorias.length > 0) {
        await client.query(
          `INSERT INTO servicio_categoria (id_servicio, id_categoria)
           SELECT $1, UNNEST($2::int[])`,
          [idServicio, categorias]
        );
      }

      const asignadas = await client.query(
        `SELECT c.id, c.nombre_categoria, c.tipo
         FROM servicio_categoria sc
         INNER JOIN categorias c ON c.id = sc.id_categoria
         WHERE sc.id_servicio = $1
         ORDER BY c.nombre_categoria ASC`,
        [idServicio]
      );

      await client.query("COMMIT");

      return res.status(200).json({
        mensaje: "Categorias de servicio actualizadas",
        id_servicio: idServicio,
        total_categorias: asignadas.rows.length,
        categorias: asignadas.rows,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(error);
      return res.status(500).json({ error: "Error al asociar categorias al servicio" });
    } finally {
      client.release();
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
