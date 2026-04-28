const express = require("express");

function createVendedorDescuentosRouter({ pool }) {
  const router = express.Router();

  function normalizarId(valor) {
    if (valor === undefined || valor === null || String(valor).trim() === "") {
      return null;
    }

    const numero = Number(valor);
    return Number.isInteger(numero) && numero > 0 ? numero : NaN;
  }

  function obtenerFechaEstado(fechaInicio, fechaFin) {
    const ahora = Date.now();
    const inicio = fechaInicio ? new Date(fechaInicio).getTime() : NaN;
    const fin = fechaFin ? new Date(fechaFin).getTime() : NaN;

    if (Number.isNaN(inicio) || Number.isNaN(fin)) {
      return "expirado";
    }

    if (ahora < inicio) return "proximo";
    if (ahora > fin) return "expirado";
    return "vigente";
  }

  async function verificarNegocio(idNegocio) {
    const negocio = await pool.query("SELECT id, nombre_comercial FROM negocios WHERE id = $1 LIMIT 1", [idNegocio]);
    return negocio.rows[0] || null;
  }

  async function verificarDescuentoDelNegocio(idDescuento, idNegocio) {
    const descuento = await pool.query(
      `SELECT id, id_negocio, codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin
       FROM descuentos
       WHERE id = $1`,
      [idDescuento]
    );

    if (descuento.rows.length === 0) {
      return { encontrado: false };
    }

    const row = descuento.rows[0];
    return {
      encontrado: true,
      pertenece: Number(row.id_negocio) === idNegocio,
      descuento: row,
    };
  }

  router.post("/api/vendedor/descuentos", async (req, res) => {
    try {
      const { id_negocio, codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin } = req.body;

      const idNegocio = normalizarId(id_negocio);
      const porcentaje = Number(porcentaje_descuento);
      const codigoCupon =
        codigo_cupon === undefined || codigo_cupon === null || String(codigo_cupon).trim() === ""
          ? null
          : String(codigo_cupon).trim().toUpperCase();

      if (!Number.isInteger(idNegocio) || idNegocio <= 0) {
        return res.status(400).json({ error: "id_negocio inválido" });
      }

      if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) {
        return res.status(400).json({ error: "porcentaje_descuento debe ser un número entre 0 y 100" });
      }

      if (!fecha_inicio || !fecha_fin) {
        return res.status(400).json({ error: "fecha_inicio y fecha_fin son requeridos" });
      }

      const fechaInicioDate = new Date(fecha_inicio);
      const fechaFinDate = new Date(fecha_fin);

      if (Number.isNaN(fechaInicioDate.getTime()) || Number.isNaN(fechaFinDate.getTime())) {
        return res.status(400).json({ error: "Formato de fechas inválido" });
      }

      if (fechaInicioDate >= fechaFinDate) {
        return res.status(400).json({ error: "fecha_inicio debe ser anterior a fecha_fin" });
      }

      const negocio = await verificarNegocio(idNegocio);
      if (!negocio) {
        return res.status(404).json({ error: "Negocio no encontrado" });
      }

      if (codigoCupon !== null) {
        const codigoExistente = await pool.query(
          "SELECT id FROM descuentos WHERE codigo_cupon = $1 LIMIT 1",
          [codigoCupon]
        );

        if (codigoExistente.rows.length > 0) {
          return res.status(409).json({ error: "El código de cupón ya existe" });
        }
      }

      const result = await pool.query(
        `INSERT INTO descuentos (id_negocio, codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, id_negocio, codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin`,
        [idNegocio, codigoCupon, porcentaje, fechaInicioDate, fechaFinDate]
      );

      return res.status(201).json({
        mensaje: "Descuento creado exitosamente",
        descuento: {
          ...result.rows[0],
          porcentaje_descuento: Number(result.rows[0].porcentaje_descuento),
          estado_descuento: obtenerFechaEstado(result.rows[0].fecha_inicio, result.rows[0].fecha_fin),
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error al crear descuento", detalle: error.message });
    }
  });

  router.put("/api/vendedor/productos/:id/descuento", async (req, res) => {
    try {
      const idProducto = Number(req.params.id);
      const idNegocio = normalizarId(req.body?.id_negocio);
      const idDescuentoNum = normalizarId(req.body?.id_descuento);

      if (!Number.isInteger(idProducto) || idProducto <= 0) {
        return res.status(400).json({ error: "ID de producto inválido" });
      }

      if (!Number.isInteger(idNegocio) || idNegocio <= 0) {
        return res.status(400).json({ error: "id_negocio inválido" });
      }

      if (req.body?.id_descuento !== undefined && req.body?.id_descuento !== null && Number.isNaN(idDescuentoNum)) {
        return res.status(400).json({ error: "id_descuento inválido" });
      }

      const producto = await pool.query(
        `SELECT id, id_negocio, nombre, precio, id_descuento AS descuento_anterior
         FROM productos
         WHERE id = $1`,
        [idProducto]
      );

      if (producto.rows.length === 0) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      if (Number(producto.rows[0].id_negocio) !== idNegocio) {
        return res.status(403).json({ error: "El producto no pertenece a este negocio" });
      }

      if (idDescuentoNum !== null) {
        const descuentoValido = await verificarDescuentoDelNegocio(idDescuentoNum, idNegocio);

        if (!descuentoValido.encontrado) {
          return res.status(404).json({ error: "Descuento no encontrado" });
        }

        if (!descuentoValido.pertenece) {
          return res.status(403).json({ error: "El descuento no pertenece a este negocio" });
        }
      }

      const result = await pool.query(
        `UPDATE productos
         SET id_descuento = $1
         WHERE id = $2
         RETURNING id, nombre, precio, id_descuento, id_negocio`,
        [idDescuentoNum, idProducto]
      );

      let descuentoDetalles = null;
      if (idDescuentoNum !== null) {
        const descuentoInfo = await pool.query(
          `SELECT id, id_negocio, codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin
           FROM descuentos
           WHERE id = $1`,
          [idDescuentoNum]
        );
        descuentoDetalles = descuentoInfo.rows[0] || null;
      }

      return res.status(200).json({
        mensaje: "Descuento asignado exitosamente",
        producto: {
          id: result.rows[0].id,
          nombre: result.rows[0].nombre,
          precio: Number(result.rows[0].precio),
          id_negocio: result.rows[0].id_negocio,
          id_descuento: result.rows[0].id_descuento,
        },
        descuento_asignado: descuentoDetalles,
        descuento_anterior: producto.rows[0].descuento_anterior,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error al asignar descuento", detalle: error.message });
    }
  });

  router.put("/api/vendedor/servicios/:id/descuento", async (req, res) => {
    try {
      const idServicio = Number(req.params.id);
      const idNegocio = normalizarId(req.body?.id_negocio);
      const idDescuentoNum = normalizarId(req.body?.id_descuento);

      if (!Number.isInteger(idServicio) || idServicio <= 0) {
        return res.status(400).json({ error: "ID de servicio inválido" });
      }

      if (!Number.isInteger(idNegocio) || idNegocio <= 0) {
        return res.status(400).json({ error: "id_negocio inválido" });
      }

      if (req.body?.id_descuento !== undefined && req.body?.id_descuento !== null && Number.isNaN(idDescuentoNum)) {
        return res.status(400).json({ error: "id_descuento inválido" });
      }

      const servicio = await pool.query(
        `SELECT id, id_negocio, nombre, precio_base, id_descuento AS descuento_anterior
         FROM servicios
         WHERE id = $1`,
        [idServicio]
      );

      if (servicio.rows.length === 0) {
        return res.status(404).json({ error: "Servicio no encontrado" });
      }

      if (Number(servicio.rows[0].id_negocio) !== idNegocio) {
        return res.status(403).json({ error: "El servicio no pertenece a este negocio" });
      }

      if (idDescuentoNum !== null) {
        const descuentoValido = await verificarDescuentoDelNegocio(idDescuentoNum, idNegocio);

        if (!descuentoValido.encontrado) {
          return res.status(404).json({ error: "Descuento no encontrado" });
        }

        if (!descuentoValido.pertenece) {
          return res.status(403).json({ error: "El descuento no pertenece a este negocio" });
        }
      }

      const result = await pool.query(
        `UPDATE servicios
         SET id_descuento = $1
         WHERE id = $2
         RETURNING id, nombre, precio_base, id_descuento, id_negocio`,
        [idDescuentoNum, idServicio]
      );

      let descuentoDetalles = null;
      if (idDescuentoNum !== null) {
        const descuentoInfo = await pool.query(
          `SELECT id, id_negocio, codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin
           FROM descuentos
           WHERE id = $1`,
          [idDescuentoNum]
        );
        descuentoDetalles = descuentoInfo.rows[0] || null;
      }

      return res.status(200).json({
        mensaje: "Descuento asignado exitosamente",
        servicio: {
          id: result.rows[0].id,
          nombre: result.rows[0].nombre,
          precio_base: Number(result.rows[0].precio_base),
          id_negocio: result.rows[0].id_negocio,
          id_descuento: result.rows[0].id_descuento,
        },
        descuento_asignado: descuentoDetalles,
        descuento_anterior: servicio.rows[0].descuento_anterior,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error al asignar descuento al servicio", detalle: error.message });
    }
  });

  async function obtenerDescuentosDelNegocio(req, res) {
    try {
      const idNegocio = Number(req.params.id_negocio);
      const estado = String(req.query?.estado || "todos").toLowerCase();

      if (!Number.isInteger(idNegocio) || idNegocio <= 0) {
        return res.status(400).json({ error: "ID de negocio inválido" });
      }

      if (!["vigentes", "todos", "proximos", "expirados"].includes(estado)) {
        return res.status(400).json({ error: "estado inválido. Usa: vigentes, todos, proximos o expirados" });
      }

      const negocio = await verificarNegocio(idNegocio);
      if (!negocio) {
        return res.status(404).json({ error: "Negocio no encontrado" });
      }

      let estadoFiltro = "";
      if (estado === "vigentes") {
        estadoFiltro = "AND CURRENT_TIMESTAMP BETWEEN d.fecha_inicio AND d.fecha_fin";
      } else if (estado === "proximos") {
        estadoFiltro = "AND d.fecha_inicio > CURRENT_TIMESTAMP";
      } else if (estado === "expirados") {
        estadoFiltro = "AND d.fecha_fin < CURRENT_TIMESTAMP";
      }

      const result = await pool.query(
        `SELECT
           d.id,
           d.id_negocio,
           d.codigo_cupon,
           d.porcentaje_descuento,
           d.fecha_inicio,
           d.fecha_fin,
           CASE
             WHEN CURRENT_TIMESTAMP BETWEEN d.fecha_inicio AND d.fecha_fin THEN 'vigente'
             WHEN d.fecha_inicio > CURRENT_TIMESTAMP THEN 'proximo'
             ELSE 'expirado'
           END AS estado_descuento
         FROM descuentos d
         WHERE d.id_negocio = $1
           ${estadoFiltro}
         ORDER BY d.fecha_fin DESC, d.porcentaje_descuento DESC`,
        [idNegocio]
      );

      return res.status(200).json({
        negocio: {
          id: negocio.id,
          nombre_comercial: negocio.nombre_comercial,
        },
        estado_filtro: estado,
        total_descuentos: result.rows.length,
        descuentos: result.rows.map((descuento) => ({
          id: descuento.id,
          id_negocio: descuento.id_negocio,
          codigo_cupon: descuento.codigo_cupon,
          porcentaje_descuento: Number(descuento.porcentaje_descuento),
          fecha_inicio: descuento.fecha_inicio,
          fecha_fin: descuento.fecha_fin,
          estado_descuento: descuento.estado_descuento,
        })),
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error al obtener descuentos del vendedor", detalle: error.message });
    }
  }

  router.get("/api/vendedor/mis-descuentos/:id_negocio", obtenerDescuentosDelNegocio);
  router.get("/api/vendedor/negocios/:id_negocio/descuentos", obtenerDescuentosDelNegocio);

  router.delete("/api/vendedor/descuentos/:id", async (req, res) => {
    try {
      const idDescuento = Number(req.params.id);
      const idNegocio = normalizarId(req.body?.id_negocio);

      if (!Number.isInteger(idDescuento) || idDescuento <= 0) {
        return res.status(400).json({ error: "ID de descuento inválido" });
      }

      if (!Number.isInteger(idNegocio) || idNegocio <= 0) {
        return res.status(400).json({ error: "id_negocio inválido" });
      }

      const descuento = await verificarDescuentoDelNegocio(idDescuento, idNegocio);

      if (!descuento.encontrado) {
        return res.status(404).json({ error: "Descuento no encontrado" });
      }

      if (!descuento.pertenece) {
        return res.status(403).json({ error: "El descuento no pertenece a este negocio" });
      }

      const productosConDescuento = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM productos
         WHERE id_descuento = $1`,
        [idDescuento]
      );

      const serviciosConDescuento = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM servicios
         WHERE id_descuento = $1`,
        [idDescuento]
      );

      const totalVinculados = Number(productosConDescuento.rows[0].total) + Number(serviciosConDescuento.rows[0].total);

      if (totalVinculados > 0) {
        return res.status(409).json({
          error: "No se puede eliminar el descuento porque todavía está asignado a productos o servicios",
          productos_asociados: Number(productosConDescuento.rows[0].total),
          servicios_asociados: Number(serviciosConDescuento.rows[0].total),
        });
      }

      await pool.query("DELETE FROM descuentos WHERE id = $1", [idDescuento]);

      return res.status(200).json({
        mensaje: "Descuento eliminado exitosamente",
        descuento_eliminado: {
          id: descuento.descuento.id,
          id_negocio: descuento.descuento.id_negocio,
          codigo_cupon: descuento.descuento.codigo_cupon,
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error al eliminar descuento", detalle: error.message });
    }
  });

  return router;
}

module.exports = createVendedorDescuentosRouter;
