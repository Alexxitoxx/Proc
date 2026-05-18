const nodemailer = require("nodemailer");

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

function normalizarEmail(email) {
	return String(email || "").trim().toLowerCase();
}

async function enviarCorreo({ to, subject, text, html }) {
	const smtp = crearTransporter();
	return smtp.transporter.sendMail({
		from: smtp.from,
		to: normalizarEmail(to),
		subject,
		text,
		html: html || text,
	});
}

module.exports = {
	crearTransporter,
	enviarCorreo,
	normalizarEmail,
};