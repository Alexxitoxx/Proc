const express = require("express");
const crypto = require("crypto");

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");  //Aplica SHA-256 al password y lo devuelve como un hash hexadecimal
}


function createLoginRouter({ pool }) {
  const router = express.Router();

  // Login
  router.post("/login", async (req, res) => {
    const { correo, email, contrasena, password } = req.body;
    const correoFinal = (correo || email || "").trim().toLowerCase();
    const passwordPlano = contrasena || password;

    try {
      if (!correoFinal || !passwordPlano) {
        return res.status(400).json({ mensaje: "Correo y contraseña son obligatorios" });
      }

      const result = await pool.query(
        `SELECT u.id, u.nombre, u.email, u.password_hash, r.nombre_rol
         FROM usuarios u
         INNER JOIN roles r ON r.id = u.id_rol
         WHERE LOWER(u.email)=LOWER($1)
           AND u.activo = TRUE
           AND u.fecha_eliminacion IS NULL
         LIMIT 1`,
        [correoFinal]
      );
      
      

      if (result.rows.length === 0) {
        return res.status(401).json({ mensaje: "Correo no registrado" });
      }

      if (result.activo === false) {
        return res.status(403).json({ mensaje: "Cuenta inactiva, contacte al administrador" });
      }

      const usuario = result.rows[0];
      const hashIngresado = hashPassword(passwordPlano);

      if (hashIngresado !== usuario.password_hash) {
        return res.status(401).json({ mensaje: "Contraseña incorrecta" });
      }

      req.session.usuario = usuario.nombre;
      req.session.usuario_id = usuario.id;
      req.session.rol = usuario.nombre_rol.toLowerCase();

    } 
    catch (error) {
      console.error(error);
      res.status(500).json({ mensaje: "Error del servidor" });
    }
  });

  // Registrar usuario
  router.post("/registrar", async (req, res) => {
    const {
      nombre_usuario,
      nombre,
      correo,
      email,
      contrasena,
      password,
      telefono,
      tipo_usuario,
      id_rol,
    } = req.body;

    const nombreFinal = (nombre || nombre_usuario || "").trim();
    const emailFinal = (email || correo || "").trim().toLowerCase();
    const passwordPlano = contrasena || password;
    const rolSolicitado = id_rol;

    try {
      if (!nombreFinal || !emailFinal || !passwordPlano) {  //#Sugeto a cambios por el front
        return res.status(400).json({
          mensaje: "Nombre, correo y contraseña son obligatorios",
        });
      }

      if (rolSolicitado && ![1, 2, 3].includes(rolSolicitado)) {
        return res.status(400).json({
          mensaje: "Rol solicitado no es válido",
        });
      }

      const existe = await pool.query("SELECT id FROM usuarios WHERE LOWER(email)=LOWER($1)", [
        emailFinal,
      ]);

      if (existe.rows.length > 0) {
        return res.status(409).json({ mensaje: "Correo ya registrado" });
      }

      const passwordHash = hashPassword(passwordPlano);

      const creado = await pool.query(
        `INSERT INTO usuarios (id_rol, nombre, email, password_hash, telefono)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, nombre, email`,
        [rolSolicitado, nombreFinal, emailFinal, passwordHash, telefono || null]
      );

      res.redirect("/login");
      
      return res.status(201).json({
        mensaje: "Usuario registrado correctamente",
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ mensaje: "Error al registrar usuario" });
    }
  });

  // Logout
  router.post("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/login");
  });

  return router;
}

module.exports = createLoginRouter;
