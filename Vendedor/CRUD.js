const express = require("express");

function createVendedorRouter({ pool }) {
  const router = express.Router();

  // Normaliza un arreglo de IDs y elimina duplicados/valores invalidos.
  function normalizarCategoriasEntrada(rawCategorias) {
    if (!Array.isArray(rawCategorias)) {
      return null;
    }

    return [...new Set(rawCategorias.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
  }

  // Crea una categoria (producto/servicio/ambos) con soporte de jerarquia por id_padre.
  router.post("/api/vendedor/categorias", async (req, res) => {
    try {
      const { nombre_categoria, descripcion, tipo, id_padre } = req.body;
      const nombre = String(nombre_categoria || "").trim();
      const tipoNormalizado = String(tipo || "").trim().toLowerCase();
      const idPadreNum =
        id_padre === undefined || id_padre === null || id_padre === "" ? null : Number(id_padre);
      const descripcionFinal =
        descripcion === undefined || descripcion === null || String(descripcion).trim() === ""
          ? null
          : String(descripcion).trim();

      if (!nombre) {
        return res.status(400).json({ error: "nombre_categoria es obligatorio" });
      }

      if (!tipoNormalizado || !["producto", "servicio", "ambos"].includes(tipoNormalizado)) {
        return res.status(400).json({ error: "tipo invalido. Usa producto, servicio o ambos" });
      }

      if (idPadreNum !== null && (!Number.isInteger(idPadreNum) || idPadreNum <= 0)) {
        return res.status(400).json({ error: "id_padre invalido" });
      }

      if (idPadreNum !== null) {
        const padre = await pool.query("SELECT id FROM categorias WHERE id = $1 LIMIT 1", [idPadreNum]);
        if (padre.rows.length === 0) {
          return res.status(404).json({ error: "Categoria padre no encontrada" });
        }
      }

      const result = await pool.query(
        `INSERT INTO categorias (nombre_categoria, id_padre, tipo, descripcion)
         VALUES ($1, $2, $3, $4)
         RETURNING id, nombre_categoria, id_padre, tipo, descripcion`,
        [nombre, idPadreNum, tipoNormalizado, descripcionFinal]
      );

      return res.status(201).json({
        mensaje: "Categoria creada correctamente",
        categoria: result.rows[0],
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "La categoria ya existe para ese nivel" });
      }

      console.error(error);
      return res.status(500).json({ error: "Error al crear categoria" });
    }
  });

  // Lista categorias y permite filtrar por tipo compatible.
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
        `SELECT id, nombre_categoria, id_padre, tipo, descripcion
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

  // Lista productos por negocio incluyendo imagen principal.
  router.get("/api/vendedor/productos/:id_negocio", async (req, res) => {
    const idNegocio = Number(req.params.id_negocio);

    if (!Number.isInteger(idNegocio) || idNegocio <= 0) {
      return res.status(400).json({ error: "id_negocio invalido" });
    }

    try {
      const result = await pool.query(
        `SELECT p.id, p.id_negocio, p.nombre, p.descripcion, p.precio, p.stock_total, p.sku,
          p.id_descuento, p.esta_activo, p.fecha_registro,
                (
                  SELECT pi.url_imagen
                  FROM producto_imagenes pi
                  WHERE pi.id_producto = p.id
                  ORDER BY pi.es_principal DESC, pi.orden_visual ASC, pi.id ASC
                  LIMIT 1
                ) AS imagen_principal
         FROM productos p
         WHERE id_negocio = $1
         ORDER BY p.id DESC`,
        [idNegocio]
      );

      return res.status(200).json(result.rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al obtener productos" });
    }
  });

  // Crea producto con imagenes opcionales y descuento opcional.
  router.post("/api/vendedor/productos", async (req, res) => {
    const { nombre, descripcion, precio, id_negocio, sku, stock_total, imagenes, id_descuento } = req.body;
    const idNegocio = Number(id_negocio);
    const precioNum = Number(precio);
    const stockTotalNum =
      stock_total === undefined || stock_total === null || stock_total === "" ? 0 : Number(stock_total);
    const idDescuentoNum =
      id_descuento === undefined || id_descuento === null || id_descuento === "" ? null : Number(id_descuento);

    if (!nombre || !Number.isFinite(precioNum) || !Number.isInteger(idNegocio) || idNegocio <= 0) {
      return res.status(400).json({ error: "Datos incompletos o invalidos" });
    }

    if (!Number.isInteger(stockTotalNum) || stockTotalNum < 0) {
      return res.status(400).json({ error: "stock_total invalido" });
    }

    if (idDescuentoNum !== null && (!Number.isInteger(idDescuentoNum) || idDescuentoNum <= 0)) {
      return res.status(400).json({ error: "id_descuento invalido" });
    }

    if (imagenes !== undefined && !Array.isArray(imagenes)) {
      return res.status(400).json({ error: "imagenes debe ser un arreglo de URLs" });
    }

    const imagenesNormalizadas =
      imagenes === undefined
        ? []
        : [...new Set(imagenes.map((url) => String(url || "").trim()).filter((url) => url.length > 0))];

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const negocio = await client.query("SELECT id FROM negocios WHERE id = $1 LIMIT 1", [idNegocio]);
      if (negocio.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Negocio no encontrado" });
      }

      if (idDescuentoNum !== null) {
        const descuento = await client.query("SELECT id FROM descuentos WHERE id = $1 LIMIT 1", [idDescuentoNum]);
        if (descuento.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Descuento no encontrado" });
        }
      }

      const result = await client.query(
        `INSERT INTO productos (nombre, descripcion, precio, id_negocio, sku, stock_total, id_descuento)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id, id_negocio, nombre, descripcion, precio, stock_total, sku, id_descuento, esta_activo, fecha_registro`,
        [
          String(nombre).trim(),
          descripcion ? String(descripcion).trim() : null,
          precioNum,
          idNegocio,
          sku || null,
          stockTotalNum,
          idDescuentoNum,
        ]
      );

      const producto = result.rows[0];

      if (imagenesNormalizadas.length > 0) {
        await client.query(
          `INSERT INTO producto_imagenes (id_producto, url_imagen, es_principal, orden_visual)
           SELECT $1, data.url_imagen, data.ord = 1, data.ord - 1
           FROM UNNEST($2::text[]) WITH ORDINALITY AS data(url_imagen, ord)`,
          [producto.id, imagenesNormalizadas]
        );
      }

      const imagenesGuardadas = await client.query(
        `SELECT id, url_imagen, es_principal, orden_visual
         FROM producto_imagenes
         WHERE id_producto = $1
         ORDER BY orden_visual ASC, id ASC`,
        [producto.id]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        ...producto,
        imagenes: imagenesGuardadas.rows,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      if (err.code === "23505") {
        return res.status(409).json({ error: "SKU duplicado" });
      }

      console.error(err);
      return res.status(500).json({ error: "Error al crear producto" });
    } finally {
      client.release();
    }
  });

  // Actualiza producto y, si se envia, reemplaza su galeria completa de imagenes.
  router.put("/api/vendedor/productos/:id", async (req, res) => {
    const idProducto = Number(req.params.id);
    const { nombre, descripcion, precio, sku, esta_activo, stock_total, imagenes, id_descuento } = req.body;
    const stockTotalNum =
      stock_total === undefined || stock_total === null || stock_total === "" ? null : Number(stock_total);
    const idDescuentoNum =
      id_descuento === undefined || id_descuento === null || id_descuento === "" ? null : Number(id_descuento);

    if (!Number.isInteger(idProducto) || idProducto <= 0) {
      return res.status(400).json({ error: "id invalido" });
    }

    if (!nombre || !Number.isFinite(Number(precio))) {
      return res.status(400).json({ error: "Nombre y precio son obligatorios" });
    }

    if (stockTotalNum !== null && (!Number.isInteger(stockTotalNum) || stockTotalNum < 0)) {
      return res.status(400).json({ error: "stock_total invalido" });
    }

    if (idDescuentoNum !== null && (!Number.isInteger(idDescuentoNum) || idDescuentoNum <= 0)) {
      return res.status(400).json({ error: "id_descuento invalido" });
    }

    if (imagenes !== undefined && !Array.isArray(imagenes)) {
      return res.status(400).json({ error: "imagenes debe ser un arreglo de URLs" });
    }

    const imagenesNormalizadas =
      imagenes === undefined
        ? null
        : [...new Set(imagenes.map((url) => String(url || "").trim()).filter((url) => url.length > 0))];

    const activo =
      esta_activo === undefined || esta_activo === null ? true : Boolean(esta_activo);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (idDescuentoNum !== null) {
        const descuento = await client.query("SELECT id FROM descuentos WHERE id = $1 LIMIT 1", [idDescuentoNum]);
        if (descuento.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Descuento no encontrado" });
        }
      }

      const result = await client.query(
        `UPDATE productos
         SET nombre = $1,
             descripcion = $2,
             precio = $3,
             sku = $4,
             esta_activo = $5,
             stock_total = COALESCE($6, stock_total),
             id_descuento = $7
         WHERE id = $8
         RETURNING id, id_negocio, nombre, descripcion, precio, stock_total, sku, id_descuento, esta_activo, fecha_registro`,
        [
          String(nombre).trim(),
          descripcion ? String(descripcion).trim() : null,
          Number(precio),
          sku || null,
          activo,
          stockTotalNum,
          idDescuentoNum,
          idProducto,
        ]
      );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      if (imagenesNormalizadas !== null) {
        await client.query("DELETE FROM producto_imagenes WHERE id_producto = $1", [idProducto]);

        if (imagenesNormalizadas.length > 0) {
          await client.query(
            `INSERT INTO producto_imagenes (id_producto, url_imagen, es_principal, orden_visual)
             SELECT $1, data.url_imagen, data.ord = 1, data.ord - 1
             FROM UNNEST($2::text[]) WITH ORDINALITY AS data(url_imagen, ord)`,
            [idProducto, imagenesNormalizadas]
          );
        }
      }

      const imagenesGuardadas = await client.query(
        `SELECT id, url_imagen, es_principal, orden_visual
         FROM producto_imagenes
         WHERE id_producto = $1
         ORDER BY orden_visual ASC, id ASC`,
        [idProducto]
      );

      await client.query("COMMIT");

      return res.status(200).json({
        ...result.rows[0],
        imagenes: imagenesGuardadas.rows,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      if (err.code === "23505") {
        return res.status(409).json({ error: "SKU duplicado" });
      }

      console.error(err);
      return res.status(500).json({ error: "Error al actualizar producto" });
    } finally {
      client.release();
    }
  });

  // Reemplaza las categorias asociadas a un producto.
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

  // Baja logica de producto (no elimina fisicamente el registro).
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

  // Lista servicios por negocio incluyendo imagen principal.
  router.get("/api/vendedor/servicios/:id_negocio", async (req, res) => {
    const idNegocio = Number(req.params.id_negocio);

    if (!Number.isInteger(idNegocio) || idNegocio <= 0) {
      return res.status(400).json({ error: "id_negocio invalido" });
    }

    try {
      const result = await pool.query(
        `SELECT s.id, s.id_negocio, s.nombre, s.descripcion, s.precio_base, s.duracion_minutos,
          s.calificacion, s.id_descuento, s.esta_activo, s.fecha_registro,
                (
                  SELECT si.url_imagen
                  FROM servicio_imagenes si
                  WHERE si.id_servicio = s.id
                  ORDER BY si.es_principal DESC, si.orden_visual ASC, si.id ASC
                  LIMIT 1
                ) AS imagen_principal
         FROM servicios s
         WHERE id_negocio = $1
         ORDER BY s.id DESC`,
        [idNegocio]
      );

      return res.status(200).json(result.rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Error al obtener servicios" });
    }
  });

  // Crea servicio con imagenes opcionales y descuento opcional.
  router.post("/api/vendedor/servicios", async (req, res) => {
    const { nombre, descripcion, precio_base, duracion_minutos, id_negocio, imagenes, id_descuento } = req.body;
    const idNegocio = Number(id_negocio);
    const precioBaseNum = Number(precio_base);
    const duracionNum =
      duracion_minutos === undefined || duracion_minutos === null || duracion_minutos === ""
        ? null
        : Number(duracion_minutos);
    const idDescuentoNum =
      id_descuento === undefined || id_descuento === null || id_descuento === "" ? null : Number(id_descuento);

    if (!nombre || !Number.isFinite(precioBaseNum) || !Number.isInteger(idNegocio) || idNegocio <= 0) {
      return res.status(400).json({ error: "Datos incompletos o invalidos" });
    }

    if (duracionNum !== null && (!Number.isInteger(duracionNum) || duracionNum <= 0)) {
      return res.status(400).json({ error: "duracion_minutos invalido" });
    }

    if (idDescuentoNum !== null && (!Number.isInteger(idDescuentoNum) || idDescuentoNum <= 0)) {
      return res.status(400).json({ error: "id_descuento invalido" });
    }

    if (imagenes !== undefined && !Array.isArray(imagenes)) {
      return res.status(400).json({ error: "imagenes debe ser un arreglo de URLs" });
    }

    const imagenesNormalizadas =
      imagenes === undefined
        ? []
        : [...new Set(imagenes.map((url) => String(url || "").trim()).filter((url) => url.length > 0))];

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const negocio = await client.query("SELECT id FROM negocios WHERE id = $1 LIMIT 1", [idNegocio]);
      if (negocio.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Negocio no encontrado" });
      }

      if (idDescuentoNum !== null) {
        const descuento = await client.query("SELECT id FROM descuentos WHERE id = $1 LIMIT 1", [idDescuentoNum]);
        if (descuento.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Descuento no encontrado" });
        }
      }

      const result = await client.query(
        `INSERT INTO servicios (nombre, descripcion, precio_base, duracion_minutos, id_negocio, id_descuento)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, id_negocio, nombre, descripcion, precio_base, duracion_minutos, calificacion, id_descuento, esta_activo, fecha_registro`,
        [
          String(nombre).trim(),
          descripcion ? String(descripcion).trim() : null,
          precioBaseNum,
          duracionNum,
          idNegocio,
          idDescuentoNum,
        ]
      );

      const servicio = result.rows[0];

      if (imagenesNormalizadas.length > 0) {
        await client.query(
          `INSERT INTO servicio_imagenes (id_servicio, url_imagen, es_principal, orden_visual)
           SELECT $1, data.url_imagen, data.ord = 1, data.ord - 1
           FROM UNNEST($2::text[]) WITH ORDINALITY AS data(url_imagen, ord)`,
          [servicio.id, imagenesNormalizadas]
        );
      }

      const imagenesGuardadas = await client.query(
        `SELECT id, url_imagen, es_principal, orden_visual
         FROM servicio_imagenes
         WHERE id_servicio = $1
         ORDER BY orden_visual ASC, id ASC`,
        [servicio.id]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        ...servicio,
        imagenes: imagenesGuardadas.rows,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      return res.status(500).json({ error: "Error al crear servicio" });
    } finally {
      client.release();
    }
  });

  // Actualiza servicio y, si se envia, reemplaza su galeria completa de imagenes.
  router.put("/api/vendedor/servicios/:id", async (req, res) => {
    const idServicio = Number(req.params.id);
    const { nombre, descripcion, precio_base, duracion_minutos, esta_activo, imagenes, id_descuento } = req.body;
    const precioBaseNum = Number(precio_base);
    const duracionNum =
      duracion_minutos === undefined || duracion_minutos === null || duracion_minutos === ""
        ? null
        : Number(duracion_minutos);
    const idDescuentoNum =
      id_descuento === undefined || id_descuento === null || id_descuento === "" ? null : Number(id_descuento);

    if (!Number.isInteger(idServicio) || idServicio <= 0) {
      return res.status(400).json({ error: "id invalido" });
    }

    if (!nombre || !Number.isFinite(precioBaseNum)) {
      return res.status(400).json({ error: "Nombre y precio_base son obligatorios" });
    }

    if (duracionNum !== null && (!Number.isInteger(duracionNum) || duracionNum <= 0)) {
      return res.status(400).json({ error: "duracion_minutos invalido" });
    }

    if (idDescuentoNum !== null && (!Number.isInteger(idDescuentoNum) || idDescuentoNum <= 0)) {
      return res.status(400).json({ error: "id_descuento invalido" });
    }

    if (imagenes !== undefined && !Array.isArray(imagenes)) {
      return res.status(400).json({ error: "imagenes debe ser un arreglo de URLs" });
    }

    const imagenesNormalizadas =
      imagenes === undefined
        ? null
        : [...new Set(imagenes.map((url) => String(url || "").trim()).filter((url) => url.length > 0))];

    const activo =
      esta_activo === undefined || esta_activo === null ? true : Boolean(esta_activo);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (idDescuentoNum !== null) {
        const descuento = await client.query("SELECT id FROM descuentos WHERE id = $1 LIMIT 1", [idDescuentoNum]);
        if (descuento.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({ error: "Descuento no encontrado" });
        }
      }

      const result = await client.query(
        `UPDATE servicios
         SET nombre = $1,
             descripcion = $2,
             precio_base = $3,
             duracion_minutos = $4,
             esta_activo = $5,
             id_descuento = $6
         WHERE id = $7
         RETURNING id, id_negocio, nombre, descripcion, precio_base, duracion_minutos, calificacion, id_descuento, esta_activo, fecha_registro`,
        [
          String(nombre).trim(),
          descripcion ? String(descripcion).trim() : null,
          precioBaseNum,
          duracionNum,
          activo,
          idDescuentoNum,
          idServicio,
        ]
      );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Servicio no encontrado" });
      }

      if (imagenesNormalizadas !== null) {
        await client.query("DELETE FROM servicio_imagenes WHERE id_servicio = $1", [idServicio]);

        if (imagenesNormalizadas.length > 0) {
          await client.query(
            `INSERT INTO servicio_imagenes (id_servicio, url_imagen, es_principal, orden_visual)
             SELECT $1, data.url_imagen, data.ord = 1, data.ord - 1
             FROM UNNEST($2::text[]) WITH ORDINALITY AS data(url_imagen, ord)`,
            [idServicio, imagenesNormalizadas]
          );
        }
      }

      const imagenesGuardadas = await client.query(
        `SELECT id, url_imagen, es_principal, orden_visual
         FROM servicio_imagenes
         WHERE id_servicio = $1
         ORDER BY orden_visual ASC, id ASC`,
        [idServicio]
      );

      await client.query("COMMIT");

      return res.status(200).json({
        ...result.rows[0],
        imagenes: imagenesGuardadas.rows,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      return res.status(500).json({ error: "Error al actualizar servicio" });
    } finally {
      client.release();
    }
  });

  // Reemplaza las categorias asociadas a un servicio.
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

  // Baja logica de servicio (no elimina fisicamente el registro).
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
