const express = require("express");
const nodemailer = require("nodemailer");

function createAdminNotificacionesRouter({ pool }) {
	const router = express.Router();

	function requireAdminSession(req, res) {
		const usuarioId = Number(req.session?.usuario_id || 0);
		const rol = String(req.session?.rol || "").toLowerCase();

		if (!Number.isInteger(usuarioId) || usuarioId <= 0) {
			res.status(401).json({ status: "error", mensaje: "Debes iniciar sesion" });
			return null;
		}

		if (rol !== "admin") {
			res.status(403).json({ status: "error", mensaje: "No autorizado" });
			return null;
		}

		return usuarioId;
	}

	async function requireActiveAdminSession(req, res) {
		const usuarioId = requireAdminSession(req, res);
		if (!usuarioId) return null;

		try {
			const activo = await pool.query(
				`SELECT u.id
				 FROM usuarios u
				 INNER JOIN roles r ON r.id = u.id_rol
				 WHERE u.id = $1
				   AND activo = TRUE
				   AND fecha_eliminacion IS NULL
				   AND LOWER(r.nombre_rol) = 'admin'
				 LIMIT 1`,
				[usuarioId]
			);

			if (activo.rows.length === 0) {
				res.status(401).json({ status: "error", mensaje: "Sesion invalida o usuario inactivo" });
				return null;
			}

			return usuarioId;
		} catch (error) {
			console.error(error);
			res.status(500).json({ status: "error", mensaje: "Error al validar sesion" });
			return null;
		}
	}

	function crearTransporter() {
		const host = String(process.env.SMTP_HOST || "").trim();
		const port = Number(process.env.SMTP_PORT || 587);
		const user = String(process.env.SMTP_USER || "").trim();
		const pass = String(process.env.SMTP_PASS || "").trim();
		const from = String(process.env.SMTP_FROM || user).trim();

		//SMTP_HOST=smtp.gmail.com
	//SMTP_PORT=587
	//SMTP_USER=tu_correo@gmail.com
	//SMTP_PASS=tu_contraseña_o_token
	//SMTP_SECURE=false"

		if (!host || !Number.isInteger(port) || port <= 0 || !user || !pass) {
			throw new Error("SMTP no configurado. Define SMTP_HOST, SMTP_PORT, SMTP_USER y SMTP_PASS.");
		}

		return {
			from,
			transporter: nodemailer.createTransport({
				host,
				port,
				secure: String(process.env.SMTP_SECURE || "false").toLowerCase() === "true",
				auth: {
					user,
					pass,
				},
			}),
		};
	}

	async function obtenerDestinatarios(reqBody) {
		const usarTodos = reqBody?.todos === true || String(reqBody?.destinatarios || "").toLowerCase() === "todos";
		const idsUsuarios = Array.isArray(reqBody?.ids_usuarios)
			? reqBody.ids_usuarios.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
			: [];
		const correosManual = Array.isArray(reqBody?.correos)
			? reqBody.correos.map((value) => String(value || "").trim().toLowerCase()).filter((value) => value.length > 0)
			: [];

		if (usarTodos) {
			const result = await pool.query(
				`SELECT id, nombre, email
				 FROM usuarios
				 WHERE activo = TRUE
				   AND fecha_eliminacion IS NULL
				   AND email IS NOT NULL
				 ORDER BY id ASC`
			);

			return result.rows.map((row) => ({
				id: row.id,
				nombre: row.nombre,
				email: String(row.email).trim().toLowerCase(),
			}));
		}

		if (idsUsuarios.length > 0) {
			const result = await pool.query(
				`SELECT id, nombre, email
				 FROM usuarios
				 WHERE id = ANY($1::int[])
				   AND activo = TRUE
				   AND fecha_eliminacion IS NULL
				   AND email IS NOT NULL
				 ORDER BY id ASC`,
				[idsUsuarios]
			);

			return result.rows.map((row) => ({
				id: row.id,
				nombre: row.nombre,
				email: String(row.email).trim().toLowerCase(),
			}));
		}

		if (correosManual.length > 0) {
			return correosManual.map((email) => ({ id: null, nombre: null, email }));
		}

		throw new Error("Debes enviar ids_usuarios, correos o activar destinatarios='todos'");
	}

	router.get("/admin/notificaciones/destinatarios", async (req, res) => {
		const adminId = await requireActiveAdminSession(req, res);
		if (!adminId) return;

		try {
			const result = await pool.query(
				`SELECT u.id, u.nombre, u.email, COALESCE(r.nombre_rol, '') AS rol
				 FROM usuarios u
				 LEFT JOIN roles r ON r.id = u.id_rol
				 WHERE u.activo = TRUE
				   AND u.fecha_eliminacion IS NULL
				   AND u.email IS NOT NULL
				 ORDER BY u.id ASC`
			);

			return res.status(200).json({
				status: "success",
				total: result.rows.length,
				destinatarios: result.rows.map((row) => ({
					id: row.id,
					nombre: row.nombre,
					email: row.email,
					rol: row.rol,
				})),
			});
		} catch (error) {
			console.error(error);
			return res.status(500).json({ status: "error", mensaje: "Error al obtener destinatarios" });
		}
	});

	router.post("/admin/notificaciones/enviar", async (req, res) => {
		const adminId = await requireActiveAdminSession(req, res);
		if (!adminId) return;

		const asunto = String(req.body?.asunto || "").trim();
		const mensaje = String(req.body?.mensaje || "").trim();
		const html = req.body?.html !== undefined && req.body?.html !== null ? String(req.body.html) : null;

		if (!asunto || !mensaje) {
			return res.status(400).json({ status: "error", mensaje: "asunto y mensaje son obligatorios" });
		}

		let remitente;
		let transporter;

		try {
			const smtp = crearTransporter();
			remitente = smtp.from;
			transporter = smtp.transporter;
		} catch (error) {
			return res.status(500).json({ status: "error", mensaje: error.message });
		}

		let destinatarios;
		try {
			destinatarios = await obtenerDestinatarios(req.body);
		} catch (error) {
			return res.status(400).json({ status: "error", mensaje: error.message });
		}

		if (destinatarios.length === 0) {
			return res.status(404).json({ status: "error", mensaje: "No se encontraron destinatarios validos" });
		}

		try {
			const resultados = await Promise.allSettled(
				destinatarios.map((destinatario) =>
					transporter.sendMail({
						from: remitente,
						to: destinatario.email,
						subject: asunto,
						text: mensaje,
						html: html || mensaje,
					})
				)
			);

			const enviados = resultados.filter((resultado) => resultado.status === "fulfilled").length;
			const fallidos = resultados
				.map((resultado, index) => ({ resultado, destinatario: destinatarios[index] }))
				.filter(({ resultado }) => resultado.status === "rejected")
				.map(({ destinatario, resultado }) => ({
					email: destinatario.email,
					error: String(resultado.reason?.message || resultado.reason || "Error al enviar correo"),
				}));

			return res.status(200).json({
				status: "success",
				mensaje: "Proceso de notificacion completado",
				resumen: {
					total_destinatarios: destinatarios.length,
					enviados,
					fallidos: fallidos.length,
				},
				fallidos,
			});
		} catch (error) {
			console.error(error);
			return res.status(500).json({ status: "error", mensaje: "Error al enviar notificaciones" });
		}
	});

	return router;
}

module.exports = createAdminNotificacionesRouter;