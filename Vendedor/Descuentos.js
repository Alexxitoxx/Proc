const express = require("express");

function createVendedorDescuentosRouter({ pool }) {
  const router = express.Router();

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

  function parseFecha(valor) {
    const fecha = new Date(valor);
    return Number.isNaN(fecha.getTime()) ? null : fecha;
  }

  async function verificarDescuento(idDescuento) {
    const result = await pool.query(
      `SELECT id, codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin
       FROM descuentos
       WHERE id = $1`,
      [idDescuento]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  }

  async function existeCodigoCupon(codigoCupon, idExcluir = null) {
    if (!codigoCupon) {
      return false;
    }

    if (idExcluir) {
      const result = await pool.query(
        `SELECT id FROM descuentos
         WHERE codigo_cupon = $1 AND id <> $2
         LIMIT 1`,
        [codigoCupon, idExcluir]
      );
      return result.rows.length > 0;
    }

    const result = await pool.query(
      `SELECT id FROM descuentos
       WHERE codigo_cupon = $1
       LIMIT 1`,
      [codigoCupon]
    );
    return result.rows.length > 0;
  }

  /**
   * POST - Crear y asignar descuento a un producto
   * Ruta: /api/vendedor/productos/:id/descuentos
   * Body: { codigo_cupon?, porcentaje_descuento, fecha_inicio, fecha_fin }
   * Valida: producto existente, porcentaje 0-100, fechas validas y cupon unico.
   * Resultado: crea registro en descuentos y lo asigna a productos.id_descuento.
   */
  router.post("/api/vendedor/productos/:id/descuentos", async (req, res) => {
    try {
      const idProducto = Number(req.params.id);
      const { codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin } = req.body;

      if (!Number.isInteger(idProducto) || idProducto <= 0) {
        return res.status(400).json({ error: "ID de producto invalido" });
      }

      const porcentaje = Number(porcentaje_descuento);
      if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) {
        return res.status(400).json({ error: "porcentaje_descuento debe ser un numero entre 0 y 100" });
      }

      const fechaInicio = parseFecha(fecha_inicio);
      const fechaFin = parseFecha(fecha_fin);
      if (!fechaInicio || !fechaFin) {
        return res.status(400).json({ error: "Formato de fechas invalido" });
      }

      if (fechaInicio >= fechaFin) {
        return res.status(400).json({ error: "fecha_inicio debe ser anterior a fecha_fin" });
      }

      const producto = await pool.query(
        `SELECT id, nombre, precio
         FROM productos
         WHERE id = $1`,
        [idProducto]
      );

      if (producto.rows.length === 0) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      const codigoCupon =
        codigo_cupon === undefined || codigo_cupon === null || String(codigo_cupon).trim() === ""
          ? null
          : String(codigo_cupon).trim().toUpperCase();

      if (await existeCodigoCupon(codigoCupon)) {
        return res.status(409).json({ error: "El codigo de cupon ya existe" });
      }

      const descuentoResult = await pool.query(
        `INSERT INTO descuentos (codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin)
         VALUES ($1, $2, $3, $4)
         RETURNING id, codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin`,
        [codigoCupon, porcentaje, fechaInicio, fechaFin]
      );

      const descuento = descuentoResult.rows[0];

      const productoActualizado = await pool.query(
        `UPDATE productos
         SET id_descuento = $1
         WHERE id = $2
         RETURNING id, nombre, precio, id_descuento`,
        [descuento.id, idProducto]
      );

      return res.status(201).json({
        mensaje: "Descuento creado y asignado al producto",
        producto: {
          id: productoActualizado.rows[0].id,
          nombre: productoActualizado.rows[0].nombre,
          precio: Number(productoActualizado.rows[0].precio),
          id_descuento: productoActualizado.rows[0].id_descuento,
        },
        descuento: {
          ...descuento,
          porcentaje_descuento: Number(descuento.porcentaje_descuento),
          estado_descuento: obtenerFechaEstado(descuento.fecha_inicio, descuento.fecha_fin),
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error al crear descuento para producto", detalle: error.message });
    }
  });

  /**
   * POST - Crear y asignar descuento a un servicio
   * Ruta: /api/vendedor/servicios/:id/descuentos
   * Body: { codigo_cupon?, porcentaje_descuento, fecha_inicio, fecha_fin }
   * Valida: servicio existente, porcentaje 0-100, fechas validas y cupon unico.
   * Resultado: crea registro en descuentos y lo asigna a servicios.id_descuento.
   */
  router.post("/api/vendedor/servicios/:id/descuentos", async (req, res) => {
    try {
      const idServicio = Number(req.params.id);
      const { codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin } = req.body;

      if (!Number.isInteger(idServicio) || idServicio <= 0) {
        return res.status(400).json({ error: "ID de servicio invalido" });
      }

      const porcentaje = Number(porcentaje_descuento);
      if (!Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) {
        return res.status(400).json({ error: "porcentaje_descuento debe ser un numero entre 0 y 100" });
      }

      const fechaInicio = parseFecha(fecha_inicio);
      const fechaFin = parseFecha(fecha_fin);
      if (!fechaInicio || !fechaFin) {
        return res.status(400).json({ error: "Formato de fechas invalido" });
      }

      if (fechaInicio >= fechaFin) {
        return res.status(400).json({ error: "fecha_inicio debe ser anterior a fecha_fin" });
      }

      const servicio = await pool.query(
        `SELECT id, nombre, precio_base
         FROM servicios
         WHERE id = $1`,
        [idServicio]
      );

      if (servicio.rows.length === 0) {
        return res.status(404).json({ error: "Servicio no encontrado" });
      }

      const codigoCupon =
        codigo_cupon === undefined || codigo_cupon === null || String(codigo_cupon).trim() === ""
          ? null
          : String(codigo_cupon).trim().toUpperCase();

      if (await existeCodigoCupon(codigoCupon)) {
        return res.status(409).json({ error: "El codigo de cupon ya existe" });
      }

      const descuentoResult = await pool.query(
        `INSERT INTO descuentos (codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin)
         VALUES ($1, $2, $3, $4)
         RETURNING id, codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin`,
        [codigoCupon, porcentaje, fechaInicio, fechaFin]
      );

      const descuento = descuentoResult.rows[0];

      const servicioActualizado = await pool.query(
        `UPDATE servicios
         SET id_descuento = $1
         WHERE id = $2
         RETURNING id, nombre, precio_base, id_descuento`,
        [descuento.id, idServicio]
      );

      return res.status(201).json({
        mensaje: "Descuento creado y asignado al servicio",
        servicio: {
          id: servicioActualizado.rows[0].id,
          nombre: servicioActualizado.rows[0].nombre,
          precio_base: Number(servicioActualizado.rows[0].precio_base),
          id_descuento: servicioActualizado.rows[0].id_descuento,
        },
        descuento: {
          ...descuento,
          porcentaje_descuento: Number(descuento.porcentaje_descuento),
          estado_descuento: obtenerFechaEstado(descuento.fecha_inicio, descuento.fecha_fin),
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error al crear descuento para servicio", detalle: error.message });
    }
  });

  /**
   * PUT - Actualizar un descuento asignado a un producto
   * Ruta: /api/vendedor/productos/:id/descuentos/:id_descuento
   * Body: { codigo_cupon?, porcentaje_descuento?, fecha_inicio?, fecha_fin? }
   * Valida: producto existente y relacion producto -> id_descuento.
   * Nota: campos omitidos conservan el valor actual del descuento.
   */
  router.put("/api/vendedor/productos/:id/descuentos/:id_descuento", async (req, res) => {
    try {
      const idProducto = Number(req.params.id);
      const idDescuento = Number(req.params.id_descuento);
      const { codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin } = req.body;

      if (!Number.isInteger(idProducto) || idProducto <= 0) {
        return res.status(400).json({ error: "ID de producto invalido" });
      }

      if (!Number.isInteger(idDescuento) || idDescuento <= 0) {
        return res.status(400).json({ error: "ID de descuento invalido" });
      }

      const producto = await pool.query(
        `SELECT id, id_descuento
         FROM productos
         WHERE id = $1`,
        [idProducto]
      );

      if (producto.rows.length === 0) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      if (Number(producto.rows[0].id_descuento) !== idDescuento) {
        return res.status(400).json({ error: "El descuento indicado no esta asignado a este producto" });
      }

      const descuentoActual = await verificarDescuento(idDescuento);
      if (!descuentoActual) {
        return res.status(404).json({ error: "Descuento no encontrado" });
      }

      const nuevoCodigo =
        codigo_cupon === undefined
          ? descuentoActual.codigo_cupon
          : codigo_cupon === null || String(codigo_cupon).trim() === ""
            ? null
            : String(codigo_cupon).trim().toUpperCase();

      const nuevoPorcentaje =
        porcentaje_descuento === undefined ? Number(descuentoActual.porcentaje_descuento) : Number(porcentaje_descuento);
      if (!Number.isFinite(nuevoPorcentaje) || nuevoPorcentaje < 0 || nuevoPorcentaje > 100) {
        return res.status(400).json({ error: "porcentaje_descuento debe ser un numero entre 0 y 100" });
      }

      const nuevaFechaInicio = fecha_inicio === undefined ? new Date(descuentoActual.fecha_inicio) : parseFecha(fecha_inicio);
      const nuevaFechaFin = fecha_fin === undefined ? new Date(descuentoActual.fecha_fin) : parseFecha(fecha_fin);
      if (!nuevaFechaInicio || !nuevaFechaFin) {
        return res.status(400).json({ error: "Formato de fechas invalido" });
      }

      if (nuevaFechaInicio >= nuevaFechaFin) {
        return res.status(400).json({ error: "fecha_inicio debe ser anterior a fecha_fin" });
      }

      if (await existeCodigoCupon(nuevoCodigo, idDescuento)) {
        return res.status(409).json({ error: "El codigo de cupon ya existe" });
      }

      const result = await pool.query(
        `UPDATE descuentos
         SET codigo_cupon = $1,
             porcentaje_descuento = $2,
             fecha_inicio = $3,
             fecha_fin = $4
         WHERE id = $5
         RETURNING id, codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin`,
        [nuevoCodigo, nuevoPorcentaje, nuevaFechaInicio, nuevaFechaFin, idDescuento]
      );

      const descuento = result.rows[0];

      return res.status(200).json({
        mensaje: "Descuento del producto actualizado exitosamente",
        descuento: {
          ...descuento,
          porcentaje_descuento: Number(descuento.porcentaje_descuento),
          estado_descuento: obtenerFechaEstado(descuento.fecha_inicio, descuento.fecha_fin),
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error al actualizar descuento del producto", detalle: error.message });
    }
  });

  /**
   * PUT - Actualizar un descuento asignado a un servicio
   * Ruta: /api/vendedor/servicios/:id/descuentos/:id_descuento
   * Body: { codigo_cupon?, porcentaje_descuento?, fecha_inicio?, fecha_fin? }
   * Valida: servicio existente y relacion servicio -> id_descuento.
   * Nota: campos omitidos conservan el valor actual del descuento.
   */
  router.put("/api/vendedor/servicios/:id/descuentos/:id_descuento", async (req, res) => {
    try {
      const idServicio = Number(req.params.id);
      const idDescuento = Number(req.params.id_descuento);
      const { codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin } = req.body;

      if (!Number.isInteger(idServicio) || idServicio <= 0) {
        return res.status(400).json({ error: "ID de servicio invalido" });
      }

      if (!Number.isInteger(idDescuento) || idDescuento <= 0) {
        return res.status(400).json({ error: "ID de descuento invalido" });
      }

      const servicio = await pool.query(
        `SELECT id, id_descuento
         FROM servicios
         WHERE id = $1`,
        [idServicio]
      );

      if (servicio.rows.length === 0) {
        return res.status(404).json({ error: "Servicio no encontrado" });
      }

      if (Number(servicio.rows[0].id_descuento) !== idDescuento) {
        return res.status(400).json({ error: "El descuento indicado no esta asignado a este servicio" });
      }

      const descuentoActual = await verificarDescuento(idDescuento);
      if (!descuentoActual) {
        return res.status(404).json({ error: "Descuento no encontrado" });
      }

      const nuevoCodigo =
        codigo_cupon === undefined
          ? descuentoActual.codigo_cupon
          : codigo_cupon === null || String(codigo_cupon).trim() === ""
            ? null
            : String(codigo_cupon).trim().toUpperCase();

      const nuevoPorcentaje =
        porcentaje_descuento === undefined ? Number(descuentoActual.porcentaje_descuento) : Number(porcentaje_descuento);
      if (!Number.isFinite(nuevoPorcentaje) || nuevoPorcentaje < 0 || nuevoPorcentaje > 100) {
        return res.status(400).json({ error: "porcentaje_descuento debe ser un numero entre 0 y 100" });
      }

      const nuevaFechaInicio = fecha_inicio === undefined ? new Date(descuentoActual.fecha_inicio) : parseFecha(fecha_inicio);
      const nuevaFechaFin = fecha_fin === undefined ? new Date(descuentoActual.fecha_fin) : parseFecha(fecha_fin);
      if (!nuevaFechaInicio || !nuevaFechaFin) {
        return res.status(400).json({ error: "Formato de fechas invalido" });
      }

      if (nuevaFechaInicio >= nuevaFechaFin) {
        return res.status(400).json({ error: "fecha_inicio debe ser anterior a fecha_fin" });
      }

      if (await existeCodigoCupon(nuevoCodigo, idDescuento)) {
        return res.status(409).json({ error: "El codigo de cupon ya existe" });
      }

      const result = await pool.query(
        `UPDATE descuentos
         SET codigo_cupon = $1,
             porcentaje_descuento = $2,
             fecha_inicio = $3,
             fecha_fin = $4
         WHERE id = $5
         RETURNING id, codigo_cupon, porcentaje_descuento, fecha_inicio, fecha_fin`,
        [nuevoCodigo, nuevoPorcentaje, nuevaFechaInicio, nuevaFechaFin, idDescuento]
      );

      const descuento = result.rows[0];

      return res.status(200).json({
        mensaje: "Descuento del servicio actualizado exitosamente",
        descuento: {
          ...descuento,
          porcentaje_descuento: Number(descuento.porcentaje_descuento),
          estado_descuento: obtenerFechaEstado(descuento.fecha_inicio, descuento.fecha_fin),
        },
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error al actualizar descuento del servicio", detalle: error.message });
    }
  });

  /**
   * DELETE - Quitar descuento de un producto
   * Ruta: /api/vendedor/productos/:id/descuentos/:id_descuento
   * Valida: producto existente y que tenga asignado ese id_descuento.
   * Resultado: deja productos.id_descuento en NULL.
   */
  router.delete("/api/vendedor/productos/:id/descuentos/:id_descuento", async (req, res) => {
    try {
      const idProducto = Number(req.params.id);
      const idDescuento = Number(req.params.id_descuento);

      if (!Number.isInteger(idProducto) || idProducto <= 0) {
        return res.status(400).json({ error: "ID de producto invalido" });
      }

      if (!Number.isInteger(idDescuento) || idDescuento <= 0) {
        return res.status(400).json({ error: "ID de descuento invalido" });
      }

      const producto = await pool.query(
        `SELECT id, id_descuento
         FROM productos
         WHERE id = $1`,
        [idProducto]
      );

      if (producto.rows.length === 0) {
        return res.status(404).json({ error: "Producto no encontrado" });
      }

      if (Number(producto.rows[0].id_descuento) !== idDescuento) {
        return res.status(400).json({ error: "El descuento indicado no esta asignado a este producto" });
      }

      await pool.query(
        `UPDATE productos
         SET id_descuento = NULL
         WHERE id = $1`,
        [idProducto]
      );

      return res.status(200).json({
        mensaje: "Descuento removido del producto exitosamente",
        producto_id: idProducto,
        descuento_removido: idDescuento,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error al remover descuento del producto", detalle: error.message });
    }
  });

  /**
   * DELETE - Quitar descuento de un servicio
   * Ruta: /api/vendedor/servicios/:id/descuentos/:id_descuento
   * Valida: servicio existente y que tenga asignado ese id_descuento.
   * Resultado: deja servicios.id_descuento en NULL.
   */
  router.delete("/api/vendedor/servicios/:id/descuentos/:id_descuento", async (req, res) => {
    try {
      const idServicio = Number(req.params.id);
      const idDescuento = Number(req.params.id_descuento);

      if (!Number.isInteger(idServicio) || idServicio <= 0) {
        return res.status(400).json({ error: "ID de servicio invalido" });
      }

      if (!Number.isInteger(idDescuento) || idDescuento <= 0) {
        return res.status(400).json({ error: "ID de descuento invalido" });
      }

      const servicio = await pool.query(
        `SELECT id, id_descuento
         FROM servicios
         WHERE id = $1`,
        [idServicio]
      );

      if (servicio.rows.length === 0) {
        return res.status(404).json({ error: "Servicio no encontrado" });
      }

      if (Number(servicio.rows[0].id_descuento) !== idDescuento) {
        return res.status(400).json({ error: "El descuento indicado no esta asignado a este servicio" });
      }

      await pool.query(
        `UPDATE servicios
         SET id_descuento = NULL
         WHERE id = $1`,
        [idServicio]
      );

      return res.status(200).json({
        mensaje: "Descuento removido del servicio exitosamente",
        servicio_id: idServicio,
        descuento_removido: idDescuento,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: "Error al remover descuento del servicio", detalle: error.message });
    }
  });

  return router;
}

module.exports = createVendedorDescuentosRouter;
