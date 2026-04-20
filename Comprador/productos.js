const express = require("express");

function createCompradorRouter({ pool }) {
  const router = express.Router();

  // Obtener categorias para el front 
  router.get("/comprador/categorias", async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, nombre_categoria, tipo
         FROM categorias
         ORDER BY nombre_categoria ASC`
      );

      return res.status(200).json(
        result.rows.map((categoria) => ({
          id: categoria.id,
          nombre: categoria.nombre_categoria,
          tipo: categoria.tipo,
        }))
      );
    } catch (error) {
      console.error(error);
      return res.status(500).json({ mensaje: "Error al obtener categorias" });
    }
  });

  // Obtener productos por categoria
  router.get("/comprador/productos/categoria/:idCategoria", async (req, res) => {
    const idCategoria = Number(req.params.idCategoria);
    const { q, precio_min, precio_max, calificacion_min, ordenar } = req.query;

    if (!Number.isInteger(idCategoria) || idCategoria <= 0) {
      return res.status(400).json({ mensaje: "idCategoria invalido" });
    }

    try {
      const filtros = ["pc.id_categoria = $1"];
      const valores = [idCategoria];
      let qLikeIndex = null;

      if (q !== undefined && String(q).trim() !== "") {
        valores.push(`%${String(q).trim()}%`);
        qLikeIndex = valores.length;
        filtros.push(
          `(p.nombre ILIKE $${qLikeIndex} OR COALESCE(p.descripcion, '') ILIKE $${qLikeIndex} OR COALESCE(n.nombre_comercial, '') ILIKE $${qLikeIndex})`
        );
      }

      const precioMinNum = Number(precio_min);
      if (precio_min !== undefined && precio_min !== "" && !Number.isNaN(precioMinNum)) {
        valores.push(precioMinNum);
        filtros.push(`p.precio >= $${valores.length}`);
      }

      const precioMaxNum = Number(precio_max);
      if (precio_max !== undefined && precio_max !== "" && !Number.isNaN(precioMaxNum)) {
        valores.push(precioMaxNum);
        filtros.push(`p.precio <= $${valores.length}`);
      }

      const calificacionMinNum = Number(calificacion_min);
      if (calificacion_min !== undefined && calificacion_min !== "" && !Number.isNaN(calificacionMinNum)) {
        valores.push(calificacionMinNum);
        filtros.push(`COALESCE(p.calificacion, 0) >= $${valores.length}`);
      }

      const orden = String(ordenar || "mejor_calificados").toLowerCase();
      let orderBy = "p.calificacion DESC NULLS LAST, COUNT(r.id) DESC, p.fecha_registro DESC";

      if (orden === "precio_menor" || orden === "precio_menor_a_mayor" || orden === "precio_asc") {
        orderBy = "p.precio ASC, p.nombre ASC";
      } else if (orden === "precio_mayor" || orden === "precio_mayor_a_menor" || orden === "precio_desc") {
        orderBy = "p.precio DESC, p.nombre ASC";
      } else if (orden === "nombre" || orden === "nombre_az") {
        orderBy = "p.nombre ASC";
      } else if (orden === "relevancia" && qLikeIndex !== null) {
        orderBy = `
          CASE
            WHEN p.nombre ILIKE $${qLikeIndex} THEN 3
            WHEN COALESCE(p.descripcion, '') ILIKE $${qLikeIndex} THEN 2
            WHEN COALESCE(n.nombre_comercial, '') ILIKE $${qLikeIndex} THEN 1
            ELSE 0
          END DESC,
          p.calificacion DESC NULLS LAST,
          COUNT(r.id) DESC,
          p.fecha_registro DESC`;
      }

      const productosResult = await pool.query(
        `SELECT
           p.id,
           p.nombre,
           p.calificacion,
           p.precio AS precio_original,
           CASE
             WHEN d.id IS NOT NULL
               AND d.codigo_cupon IS NULL
               AND CURRENT_TIMESTAMP BETWEEN d.fecha_inicio AND d.fecha_fin
             THEN ROUND((p.precio * (1 - (d.porcentaje_descuento / 100)))::numeric, 2)
             ELSE p.precio
           END AS precio,
           CASE
             WHEN d.id IS NOT NULL
               AND d.codigo_cupon IS NULL
               AND CURRENT_TIMESTAMP BETWEEN d.fecha_inicio AND d.fecha_fin
             THEN d.porcentaje_descuento
             ELSE NULL
           END AS porcentaje_descuento,
           pi.url_imagen AS imagen_principal,
           COALESCE(n.nombre_comercial, '') AS empresa,
           COUNT(r.id) AS numero_resenas
         FROM productos p
         INNER JOIN producto_categoria pc ON pc.id_producto = p.id
         LEFT JOIN negocios n ON n.id = p.id_negocio
         LEFT JOIN descuentos d ON d.id = p.id_descuento
         LEFT JOIN producto_imagenes pi ON pi.id_producto = p.id AND pi.es_principal = TRUE
         LEFT JOIN resenas r ON r.id_producto = p.id
         WHERE p.esta_activo = TRUE
           AND ${filtros.join(" AND ")}
         GROUP BY p.id, p.nombre, p.calificacion, p.precio, pi.url_imagen, n.nombre_comercial, p.fecha_registro,
                  d.id, d.codigo_cupon, d.porcentaje_descuento, d.fecha_inicio, d.fecha_fin
         ORDER BY ${orderBy}`,
        valores
      );

      return res.status(200).json({
        id_categoria: idCategoria,
        filtros: {
          q: q || null,
          precio_min: precio_min || null,
          precio_max: precio_max || null,
          calificacion_min: calificacion_min || null,
          ordenar: ordenar || "mejor_calificados",
        },
        total: productosResult.rows.length,
        productos: productosResult.rows,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ mensaje: "Error al obtener productos por categoria" });
    }
  });

  // Obtener servicios por categoria
  router.get("/comprador/servicios/categoria/:idCategoria", async (req, res) => {
    const idCategoria = Number(req.params.idCategoria);
    const { q, precio_min, precio_max, calificacion_min, ordenar } = req.query;

    if (!Number.isInteger(idCategoria) || idCategoria <= 0) {
      return res.status(400).json({ mensaje: "idCategoria invalido" });
    }

    try {
      const filtros = ["sc.id_categoria = $1"];
      const valores = [idCategoria];
      let qLikeIndex = null;

      if (q !== undefined && String(q).trim() !== "") {
        valores.push(`%${String(q).trim()}%`);
        qLikeIndex = valores.length;
        filtros.push(
          `(s.nombre ILIKE $${qLikeIndex} OR COALESCE(s.descripcion, '') ILIKE $${qLikeIndex} OR COALESCE(n.nombre_comercial, '') ILIKE $${qLikeIndex})`
        );
      }

      const precioMinNum = Number(precio_min);
      if (precio_min !== undefined && precio_min !== "" && !Number.isNaN(precioMinNum)) {
        valores.push(precioMinNum);
        filtros.push(`s.precio_base >= $${valores.length}`);
      }

      const precioMaxNum = Number(precio_max);
      if (precio_max !== undefined && precio_max !== "" && !Number.isNaN(precioMaxNum)) {
        valores.push(precioMaxNum);
        filtros.push(`s.precio_base <= $${valores.length}`);
      }

      const calificacionMinNum = Number(calificacion_min);
      if (calificacion_min !== undefined && calificacion_min !== "" && !Number.isNaN(calificacionMinNum)) {
        valores.push(calificacionMinNum);
        filtros.push(`COALESCE(s.calificacion, 0) >= $${valores.length}`);
      }

      const orden = String(ordenar || "mejor_calificados").toLowerCase();
      let orderBy = "s.calificacion DESC NULLS LAST, COUNT(r.id) DESC, s.fecha_registro DESC";

      if (orden === "precio_menor" || orden === "precio_menor_a_mayor" || orden === "precio_asc") {
        orderBy = "s.precio_base ASC, s.nombre ASC";
      } else if (orden === "precio_mayor" || orden === "precio_mayor_a_menor" || orden === "precio_desc") {
        orderBy = "s.precio_base DESC, s.nombre ASC";
      } else if (orden === "nombre" || orden === "nombre_az") {
        orderBy = "s.nombre ASC";
      } else if (orden === "relevancia" && qLikeIndex !== null) {
        orderBy = `
          CASE
            WHEN s.nombre ILIKE $${qLikeIndex} THEN 3
            WHEN COALESCE(s.descripcion, '') ILIKE $${qLikeIndex} THEN 2
            WHEN COALESCE(n.nombre_comercial, '') ILIKE $${qLikeIndex} THEN 1
            ELSE 0
          END DESC,
          s.calificacion DESC NULLS LAST,
          COUNT(r.id) DESC,
          s.fecha_registro DESC`;
      }

      const serviciosResult = await pool.query(
        `SELECT
           s.id,
           s.nombre,
           s.calificacion,
           s.precio_base AS precio_original,
           CASE
             WHEN d.id IS NOT NULL
               AND d.codigo_cupon IS NULL
               AND CURRENT_TIMESTAMP BETWEEN d.fecha_inicio AND d.fecha_fin
             THEN ROUND((s.precio_base * (1 - (d.porcentaje_descuento / 100)))::numeric, 2)
             ELSE s.precio_base
           END AS precio,
           CASE
             WHEN d.id IS NOT NULL
               AND d.codigo_cupon IS NULL
               AND CURRENT_TIMESTAMP BETWEEN d.fecha_inicio AND d.fecha_fin
             THEN d.porcentaje_descuento
             ELSE NULL
           END AS porcentaje_descuento,
           si.url_imagen AS imagen_principal,
           COALESCE(n.nombre_comercial, '') AS empresa,
           COUNT(r.id) AS numero_resenas
         FROM servicios s
         INNER JOIN servicio_categoria sc ON sc.id_servicio = s.id
         INNER JOIN negocios n ON n.id = s.id_negocio
         LEFT JOIN descuentos d ON d.id = s.id_descuento
         LEFT JOIN servicio_imagenes si ON si.id_servicio = s.id AND si.es_principal = TRUE
         LEFT JOIN resenas r ON r.id_servicio = s.id
         WHERE s.esta_activo = TRUE
           AND ${filtros.join(" AND ")}
         GROUP BY s.id, s.nombre, s.calificacion, s.precio_base, si.url_imagen, n.nombre_comercial, s.fecha_registro,
                  d.id, d.codigo_cupon, d.porcentaje_descuento, d.fecha_inicio, d.fecha_fin
         ORDER BY ${orderBy}`,
        valores
      );

      return res.status(200).json({
        id_categoria: idCategoria,
        filtros: {
          q: q || null,
          precio_min: precio_min || null,
          precio_max: precio_max || null,
          calificacion_min: calificacion_min || null,
          ordenar: ordenar || "mejor_calificados",
        },
        total: serviciosResult.rows.length,
        servicios: serviciosResult.rows,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ mensaje: "Error al obtener servicios por categoria" });
    }
  });

  // Consultar detalle de un producto
  router.get("/comprador/productos/:idProducto", async (req, res) => {
    const idProducto = Number(req.params.idProducto);

    if (!Number.isInteger(idProducto) || idProducto <= 0) {
      return res.status(400).json({ mensaje: "idProducto invalido" });
    }

    try {
      const productoResult = await pool.query(
        `SELECT
           p.id,
           p.nombre,
           p.descripcion,
           p.calificacion,
           p.precio AS precio_original,
           CASE
             WHEN d.id IS NOT NULL
               AND d.codigo_cupon IS NULL
               AND CURRENT_TIMESTAMP BETWEEN d.fecha_inicio AND d.fecha_fin
             THEN ROUND((p.precio * (1 - (d.porcentaje_descuento / 100)))::numeric, 2)
             ELSE p.precio
           END AS precio,
           CASE
             WHEN d.id IS NOT NULL
               AND d.codigo_cupon IS NULL
               AND CURRENT_TIMESTAMP BETWEEN d.fecha_inicio AND d.fecha_fin
             THEN d.porcentaje_descuento
             ELSE NULL
           END AS porcentaje_descuento,
           p.sku,
           p.fecha_registro,
           p.stock_total,
           img.url_imagen AS imagen_principal,
           COALESCE(
             (
               SELECT json_agg(
                 json_build_object(
                   'id', pi.id,
                   'url_imagen', pi.url_imagen,
                   'es_principal', pi.es_principal,
                   'orden_visual', pi.orden_visual
                 )
                 ORDER BY pi.es_principal DESC, pi.orden_visual ASC, pi.id ASC
               )
               FROM producto_imagenes pi
               WHERE pi.id_producto = p.id
             ),
             '[]'::json
           ) AS galeria_imagenes,
           COALESCE(n.nombre_comercial, '') AS empresa,
           COALESCE(
             (
               SELECT COUNT(*)
               FROM resenas r
               WHERE r.id_producto = p.id
             ),
             0
           ) AS numero_resenas,
           COALESCE(
             (
               SELECT array_agg(c.nombre_categoria ORDER BY c.nombre_categoria ASC)
               FROM producto_categoria pc
               INNER JOIN categorias c ON c.id = pc.id_categoria
               WHERE pc.id_producto = p.id
             ),
             ARRAY[]::varchar[]
           ) AS categorias
         FROM productos p
         LEFT JOIN negocios n ON n.id = p.id_negocio
         LEFT JOIN descuentos d ON d.id = p.id_descuento
         LEFT JOIN producto_imagenes img ON img.id_producto = p.id AND img.es_principal = TRUE
         WHERE p.id = $1
           AND p.esta_activo = TRUE
         LIMIT 1`,
        [idProducto]
      );

      if (productoResult.rows.length === 0) {
        return res.status(404).json({ mensaje: "Producto no encontrado" });
      }

      const resenasResult = await pool.query(
        `SELECT
           r.id,
           r.calificacion,
           r.comentario,
           r.compra_verificada,
           r.fecha_creacion,
           u.id AS id_usuario,
           u.nombre AS usuario
         FROM resenas r
         INNER JOIN usuarios u ON u.id = r.id_usuario
         WHERE r.id_producto = $1
         ORDER BY r.fecha_creacion DESC`,
        [idProducto]
      );

      const producto = productoResult.rows[0];

      return res.status(200).json({
        producto: {
          id: producto.id,
          nombre: producto.nombre,
          descripcion: producto.descripcion,
          calificacion: producto.calificacion !== null ? Number(producto.calificacion) : null,
          precio: Number(producto.precio),
          precio_original: Number(producto.precio_original),
          porcentaje_descuento: producto.porcentaje_descuento !== null ? Number(producto.porcentaje_descuento) : null,
          sku: producto.sku,
          fecha_registro: producto.fecha_registro,
          imagen_principal: producto.imagen_principal,
          galeria_imagenes: producto.galeria_imagenes,
          empresa: producto.empresa,
          stock_total: Number(producto.stock_total),
          numero_resenas: Number(producto.numero_resenas),
          categorias: producto.categorias,
          resenas: resenasResult.rows.map((resena) => ({
            id: resena.id,
            calificacion: Number(resena.calificacion),
            comentario: resena.comentario,
            compra_verificada: resena.compra_verificada,
            fecha_creacion: resena.fecha_creacion,
            usuario: {
              id: resena.id_usuario,
              nombre: resena.usuario,
            },
          })),
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ mensaje: "Error al obtener detalle del producto" });
    }
  });

  // Consultar detalle de un servicio
  router.get("/comprador/servicios/:idServicio", async (req, res) => {
    const idServicio = Number(req.params.idServicio);

    if (!Number.isInteger(idServicio) || idServicio <= 0) {
      return res.status(400).json({ mensaje: "idServicio invalido" });
    }

    try {
      const servicioResult = await pool.query(
        `SELECT
           s.id,
           s.nombre,
           s.descripcion,
           s.calificacion,
           s.precio_base AS precio_original,
           CASE
             WHEN d.id IS NOT NULL
               AND d.codigo_cupon IS NULL
               AND CURRENT_TIMESTAMP BETWEEN d.fecha_inicio AND d.fecha_fin
             THEN ROUND((s.precio_base * (1 - (d.porcentaje_descuento / 100)))::numeric, 2)
             ELSE s.precio_base
           END AS precio,
           CASE
             WHEN d.id IS NOT NULL
               AND d.codigo_cupon IS NULL
               AND CURRENT_TIMESTAMP BETWEEN d.fecha_inicio AND d.fecha_fin
             THEN d.porcentaje_descuento
             ELSE NULL
           END AS porcentaje_descuento,
           s.duracion_minutos,
           s.fecha_registro,
           img.url_imagen AS imagen_principal,
           COALESCE(
             (
               SELECT json_agg(
                 json_build_object(
                   'id', si.id,
                   'url_imagen', si.url_imagen,
                   'es_principal', si.es_principal,
                   'orden_visual', si.orden_visual
                 )
                 ORDER BY si.es_principal DESC, si.orden_visual ASC, si.id ASC
               )
               FROM servicio_imagenes si
               WHERE si.id_servicio = s.id
             ),
             '[]'::json
           ) AS galeria_imagenes,
           COALESCE(n.nombre_comercial, '') AS empresa,
           COALESCE(
             (
               SELECT COUNT(*)
               FROM resenas r
               WHERE r.id_servicio = s.id
             ),
             0
           ) AS numero_resenas
         FROM servicios s
         LEFT JOIN negocios n ON n.id = s.id_negocio
         LEFT JOIN descuentos d ON d.id = s.id_descuento
         LEFT JOIN servicio_imagenes img ON img.id_servicio = s.id AND img.es_principal = TRUE
         WHERE s.id = $1
           AND s.esta_activo = TRUE
         LIMIT 1`,
        [idServicio]
      );

      if (servicioResult.rows.length === 0) {
        return res.status(404).json({ mensaje: "Servicio no encontrado" });
      }

      const agendaResult = await pool.query(
        `SELECT
           ag.id,
           ag.fecha_hora_inicio,
           ag.fecha_hora_fin,
           ag.estado,
           n.nombre_comercial,
           d.calle,
           d.ciudad,
           d.estado AS estado_direccion,
           d.codigo_postal,
           d.pais
         FROM agenda_servicios ag
         INNER JOIN servicios s ON s.id = ag.id_servicio
         LEFT JOIN negocios n ON n.id = s.id_negocio
         LEFT JOIN direcciones d ON d.id = n.id_direccion
         WHERE ag.id_servicio = $1
           AND ag.estado = 'disponible'
         ORDER BY ag.fecha_hora_inicio ASC`,
        [idServicio]
      );

      const resenasResult = await pool.query(
        `SELECT
           r.id,
           r.calificacion,
           r.comentario,
           r.compra_verificada,
           r.fecha_creacion,
           u.id AS id_usuario,
           u.nombre AS usuario
         FROM resenas r
         INNER JOIN usuarios u ON u.id = r.id_usuario
         WHERE r.id_servicio = $1
         ORDER BY r.fecha_creacion DESC`,
        [idServicio]
      );

      const categoriasResult = await pool.query(
        `SELECT c.nombre_categoria
         FROM servicio_categoria sc
         INNER JOIN categorias c ON c.id = sc.id_categoria
         WHERE sc.id_servicio = $1
         ORDER BY c.nombre_categoria ASC`,
        [idServicio]
      );

      const servicio = servicioResult.rows[0];

      return res.status(200).json({
        servicio: {
          id: servicio.id,
          nombre: servicio.nombre,
          descripcion: servicio.descripcion,
          calificacion: servicio.calificacion !== null ? Number(servicio.calificacion) : null,
          precio: Number(servicio.precio),
          precio_original: Number(servicio.precio_original),
          porcentaje_descuento: servicio.porcentaje_descuento !== null ? Number(servicio.porcentaje_descuento) : null,
          duracion_minutos: servicio.duracion_minutos,
          fecha_registro: servicio.fecha_registro,
          imagen_principal: servicio.imagen_principal,
          galeria_imagenes: servicio.galeria_imagenes,
          empresa: servicio.empresa,
          numero_resenas: Number(servicio.numero_resenas),
          categorias: categoriasResult.rows.map((categoria) => categoria.nombre_categoria),
          agenda_disponible: agendaResult.rows.map((slot) => ({
            id: slot.id,
            id_sucursal: null,
            fecha_hora_inicio: slot.fecha_hora_inicio,
            fecha_hora_fin: slot.fecha_hora_fin,
            estado: slot.estado,
            sucursal: {
              nombre: slot.nombre_comercial,
              direccion: {
                calle: slot.calle,
                ciudad: slot.ciudad,
                estado: slot.estado_direccion,
                codigo_postal: slot.codigo_postal,
                pais: slot.pais,
              },
            },
          })),
          resenas: resenasResult.rows.map((resena) => ({
            id: resena.id,
            calificacion: Number(resena.calificacion),
            comentario: resena.comentario,
            compra_verificada: resena.compra_verificada,
            fecha_creacion: resena.fecha_creacion,
            usuario: {
              id: resena.id_usuario,
              nombre: resena.usuario,
            },
          })),
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ mensaje: "Error al obtener detalle del servicio" });
    }
  });

  return router;
}

module.exports = createCompradorRouter;
