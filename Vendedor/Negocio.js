const express = require("express");

function createVendedorBusinessRouter({ pool }) {
  const router = express.Router();

  const requireVendedorAuth = async (req, res, next) => {
    const usuarioId = Number(req.session?.usuario_id || 0);
    const rol = String(req.session?.rol || "").toLowerCase();

    if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
      return res.status(401).json({ status: "error", mensaje: "No autorizado" });
    }

    if (rol !== "vendedor") {
      return res.status(403).json({ status: "error", mensaje: "No autorizado para esta accion" });
    }

    try {
      const usuarioActivo = await pool.query(
        `SELECT u.id
         FROM usuarios u
         INNER JOIN roles r ON r.id = u.id_rol
         WHERE u.id = $1
           AND u.activo = TRUE
           AND u.fecha_eliminacion IS NULL
           AND LOWER(r.nombre_rol) = 'vendedor'
         LIMIT 1`,
        [usuarioId]
      );

      if (usuarioActivo.rows.length === 0) {
        return res.status(401).json({ status: "error", mensaje: "Sesion invalida o usuario inactivo" });
      }
    } catch (error) {
      console.error("Error al validar sesion de vendedor:", error);
      return res.status(500).json({ status: "error", mensaje: "Error al validar sesion" });
    }

    return next();
  };

  router.get("/api/vendedor/negocios", requireVendedorAuth, async (req, res) => {
    const usuarioId = Number(req.session?.usuario_id || 0);

    try {
      const result = await pool.query(
        `SELECT
           n.id,
           n.id_usuario,
           n.nombre_comercial,
           n.rfc_tax_id,
           n.logo_url,
           n.fecha_creacion,
           d.id AS id_direccion,
           d.calle,
           d.ciudad,
           d.estado,
           d.codigo_postal,
           d.pais,
           ST_Y(d.geo_location::geometry) AS latitud,
           ST_X(d.geo_location::geometry) AS longitud
         FROM negocios n
         INNER JOIN direcciones d ON d.id = n.id_direccion
         WHERE n.id_usuario = $1
         ORDER BY n.fecha_creacion DESC, n.id DESC`,
        [usuarioId]
      );

      return res.status(200).json({
        status: "success",
        total: result.rows.length,
        negocios: result.rows.map((row) => ({
          id: row.id,
          id_usuario: row.id_usuario,
          nombre_comercial: row.nombre_comercial,
          rfc_tax_id: row.rfc_tax_id,
          logo_url: row.logo_url,
          fecha_creacion: row.fecha_creacion,
          direccion: {
            id: row.id_direccion,
            calle: row.calle,
            ciudad: row.ciudad,
            estado: row.estado,
            codigo_postal: row.codigo_postal,
            pais: row.pais,
            latitud: row.latitud !== null ? Number(row.latitud) : null,
            longitud: row.longitud !== null ? Number(row.longitud) : null,
          },
        })),
      });
    } catch (error) {
      console.error("Error al obtener negocios del usuario:", error);
      return res.status(500).json({ status: "error", mensaje: "Error al obtener negocios" });
    }
  });

  router.get("/api/vendedor/negocio", requireVendedorAuth, async (req, res) => {
    const usuarioId = Number(req.session?.usuario_id || 0);

    try {
      const result = await pool.query(
        `SELECT
           n.id,
           n.id_usuario,
           n.nombre_comercial,
           n.rfc_tax_id,
           n.logo_url,
           n.fecha_creacion,
           d.id AS id_direccion,
           d.calle,
           d.ciudad,
           d.estado,
           d.codigo_postal,
           d.pais,
           ST_Y(d.geo_location::geometry) AS latitud,
           ST_X(d.geo_location::geometry) AS longitud
         FROM negocios n
         INNER JOIN direcciones d ON d.id = n.id_direccion
         WHERE n.id_usuario = $1
         ORDER BY n.fecha_creacion DESC, n.id DESC
         LIMIT 1`,
        [usuarioId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ status: "error", mensaje: "Negocio no encontrado" });
      }

      const row = result.rows[0];
      return res.status(200).json({
        status: "success",
        negocio: {
          id: row.id,
          id_usuario: row.id_usuario,
          nombre_comercial: row.nombre_comercial,
          rfc_tax_id: row.rfc_tax_id,
          logo_url: row.logo_url,
          fecha_creacion: row.fecha_creacion,
          direccion: {
            id: row.id_direccion,
            calle: row.calle,
            ciudad: row.ciudad,
            estado: row.estado,
            codigo_postal: row.codigo_postal,
            pais: row.pais,
            latitud: row.latitud !== null ? Number(row.latitud) : null,
            longitud: row.longitud !== null ? Number(row.longitud) : null,
          },
        },
      });
    } catch (error) {
      console.error("Error al obtener negocio:", error);
      return res.status(500).json({ status: "error", mensaje: "Error al obtener datos del negocio" });
    }
  });

  router.post("/api/vendedor/negocio", requireVendedorAuth, async (req, res) => {
    const usuarioId = Number(req.session?.usuario_id || 0);
    const {
      nombre_comercial,
      rfc_tax_id,
      logo_url,
      calle,
      ciudad,
      estado,
      codigo_postal,
      pais,
      latitud,
      longitud,
    } = req.body;

    const nombreComercial = String(nombre_comercial || "").trim();
    const calleFinal = String(calle || "").trim();
    const ciudadFinal = String(ciudad || "").trim();
    const estadoFinal = String(estado || "").trim();
    const codigoPostalFinal = String(codigo_postal || "").trim();
    const paisFinal = String(pais || "").trim();
    const lat = Number(latitud);
    const lng = Number(longitud);
    const rfcFinal = rfc_tax_id === undefined || rfc_tax_id === null || String(rfc_tax_id).trim() === ""
      ? null
      : String(rfc_tax_id).trim();
    const logoUrlFinal = logo_url === undefined || logo_url === null || String(logo_url).trim() === ""
      ? null
      : String(logo_url).trim();

    if (!nombreComercial || !calleFinal || !ciudadFinal || !estadoFinal || !codigoPostalFinal || !paisFinal) {
      return res.status(400).json({ status: "error", mensaje: "Faltan campos obligatorios del negocio o direccion" });
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ status: "error", mensaje: "latitud y longitud son obligatorias" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const existe = await client.query(
        `SELECT id
         FROM negocios
         WHERE id_usuario = $1
         LIMIT 1`,
        [usuarioId]
      );

      if (existe.rows.length > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({ status: "error", mensaje: "Ya tienes un negocio registrado" });
      }

      const direccion = await client.query(
        `INSERT INTO direcciones (calle, ciudad, estado, codigo_postal, pais, geo_location)
         VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography)
         RETURNING id, calle, ciudad, estado, codigo_postal, pais,
                   ST_Y(geo_location::geometry) AS latitud,
                   ST_X(geo_location::geometry) AS longitud`,
        [calleFinal, ciudadFinal, estadoFinal, codigoPostalFinal, paisFinal, lng, lat]
      );

      const negocio = await client.query(
        `INSERT INTO negocios (id_usuario, nombre_comercial, rfc_tax_id, id_direccion, logo_url)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, id_usuario, nombre_comercial, rfc_tax_id, id_direccion, logo_url, fecha_creacion`,
        [usuarioId, nombreComercial, rfcFinal, direccion.rows[0].id, logoUrlFinal]
      );

      await client.query("COMMIT");

      return res.status(201).json({
        status: "success",
        mensaje: "Negocio registrado correctamente",
        negocio: {
          ...negocio.rows[0],
          direccion: {
            id: direccion.rows[0].id,
            calle: direccion.rows[0].calle,
            ciudad: direccion.rows[0].ciudad,
            estado: direccion.rows[0].estado,
            codigo_postal: direccion.rows[0].codigo_postal,
            pais: direccion.rows[0].pais,
            latitud: Number(direccion.rows[0].latitud),
            longitud: Number(direccion.rows[0].longitud),
          },
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        return res.status(409).json({ status: "error", mensaje: "RFC ya registrado" });
      }

      console.error("Error al registrar negocio:", error);
      return res.status(500).json({ status: "error", mensaje: "Error al registrar negocio" });
    } finally {
      client.release();
    }
  });

  router.put("/api/vendedor/negocio", requireVendedorAuth, async (req, res) => {
    const usuarioId = Number(req.session?.usuario_id || 0);
    const {
      nombre_comercial,
      rfc_tax_id,
      logo_url,
      calle,
      ciudad,
      estado,
      codigo_postal,
      pais,
      latitud,
      longitud,
    } = req.body;

    const nombreComercial = String(nombre_comercial || "").trim();
    const calleFinal = String(calle || "").trim();
    const ciudadFinal = String(ciudad || "").trim();
    const estadoFinal = String(estado || "").trim();
    const codigoPostalFinal = String(codigo_postal || "").trim();
    const paisFinal = String(pais || "").trim();
    const lat = Number(latitud);
    const lng = Number(longitud);
    const rfcFinal = rfc_tax_id === undefined || rfc_tax_id === null || String(rfc_tax_id).trim() === ""
      ? null
      : String(rfc_tax_id).trim();
    const logoUrlFinal = logo_url === undefined || logo_url === null || String(logo_url).trim() === ""
      ? null
      : String(logo_url).trim();

    if (!nombreComercial || !calleFinal || !ciudadFinal || !estadoFinal || !codigoPostalFinal || !paisFinal) {
      return res.status(400).json({ status: "error", mensaje: "Faltan campos obligatorios del negocio o direccion" });
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ status: "error", mensaje: "latitud y longitud son obligatorias" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const negocioActual = await client.query(
        `SELECT id, id_direccion
         FROM negocios
         WHERE id_usuario = $1
         ORDER BY fecha_creacion DESC, id DESC
         LIMIT 1`,
        [usuarioId]
      );

      if (negocioActual.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ status: "error", mensaje: "Negocio no encontrado" });
      }

      const idNegocio = Number(negocioActual.rows[0].id);
      const idDireccion = Number(negocioActual.rows[0].id_direccion);

      const negocio = await client.query(
        `UPDATE negocios
         SET nombre_comercial = $1,
             rfc_tax_id = $2,
             logo_url = $3
         WHERE id = $4
         RETURNING id, id_usuario, nombre_comercial, rfc_tax_id, id_direccion, logo_url, fecha_creacion`,
        [nombreComercial, rfcFinal, logoUrlFinal, idNegocio]
      );

      const direccion = await client.query(
        `UPDATE direcciones
         SET calle = $1,
             ciudad = $2,
             estado = $3,
             codigo_postal = $4,
             pais = $5,
             geo_location = ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography
         WHERE id = $8
         RETURNING id, calle, ciudad, estado, codigo_postal, pais,
                   ST_Y(geo_location::geometry) AS latitud,
                   ST_X(geo_location::geometry) AS longitud`,
        [calleFinal, ciudadFinal, estadoFinal, codigoPostalFinal, paisFinal, lng, lat, idDireccion]
      );

      await client.query("COMMIT");

      return res.status(200).json({
        status: "success",
        mensaje: "Negocio actualizado correctamente",
        negocio: {
          ...negocio.rows[0],
          direccion: {
            id: direccion.rows[0].id,
            calle: direccion.rows[0].calle,
            ciudad: direccion.rows[0].ciudad,
            estado: direccion.rows[0].estado,
            codigo_postal: direccion.rows[0].codigo_postal,
            pais: direccion.rows[0].pais,
            latitud: Number(direccion.rows[0].latitud),
            longitud: Number(direccion.rows[0].longitud),
          },
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        return res.status(409).json({ status: "error", mensaje: "RFC ya registrado" });
      }

      console.error("Error al actualizar negocio:", error);
      return res.status(500).json({ status: "error", mensaje: "Error al actualizar negocio" });
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = createVendedorBusinessRouter;
