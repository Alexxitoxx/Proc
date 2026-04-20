const express = require("express");
const crypto = require("crypto");

const ROLE_NAMES_BY_ID = {
  1: "comprador",
  2: "vendedor",
  3: "admin",
};

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function normalizeRoleId(rawRole) {
  if (rawRole === undefined || rawRole === null || rawRole === "") {
    return 1;
  }

  const normalizedText = String(rawRole).trim().toLowerCase();
  if (["comprador", "cliente", "usuario"].includes(normalizedText)) {
    return 1;
  }

  if (["vendedor", "seller"].includes(normalizedText)) {
    return 2;
  }

  if (["admin", "administrador"].includes(normalizedText)) {
    return 3;
  }

  const normalizedNumber = Number(rawRole);
  if (Number.isInteger(normalizedNumber) && [1, 2, 3].includes(normalizedNumber)) {
    return normalizedNumber;
  }

  return null;
}

function getRoleNameById(idRol, dbRoleName) {
  if (dbRoleName) {
    return String(dbRoleName).trim().toLowerCase();
  }

  return ROLE_NAMES_BY_ID[idRol] || "comprador";
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
        `SELECT u.id, u.nombre, u.email, u.password_hash, u.id_rol,
                u.activo, u.fecha_eliminacion,
                COALESCE(LOWER(r.nombre_rol), '') AS nombre_rol
         FROM usuarios u
         LEFT JOIN roles r ON r.id = u.id_rol
         WHERE LOWER(u.email)=LOWER($1)
         LIMIT 1`,
        [correoFinal]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({ mensaje: "Correo no registrado" });
      }

      const usuario = result.rows[0];

      if (usuario.activo === false || usuario.fecha_eliminacion !== null) {
        return res.status(403).json({ mensaje: "Cuenta inactiva, contacte al administrador" });
      }

      const hashIngresado = hashPassword(passwordPlano);

      if (hashIngresado !== usuario.password_hash) {
        return res.status(401).json({ mensaje: "Contraseña incorrecta" });
      }

      const rolNormalizado = getRoleNameById(usuario.id_rol, usuario.nombre_rol);

      req.session.usuario = usuario.nombre;
      req.session.usuario_id = usuario.id;
      req.session.rol = rolNormalizado;

      return res.status(200).json({
        mensaje: "Sesion iniciada correctamente",
        usuario: {
          id: usuario.id,
          nombre: usuario.nombre,
          email: usuario.email,
          rol: rolNormalizado,
        },
      });

    } 
    catch (error) {
      console.error(error);
      return res.status(500).json({ mensaje: "Error del servidor" });
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
    const rolSolicitado = normalizeRoleId(id_rol ?? tipo_usuario);

    try {
      if (!nombreFinal || !emailFinal || !passwordPlano) {  //#Sugeto a cambios por el front
        return res.status(400).json({
          mensaje: "Nombre, correo y contraseña son obligatorios",
        });
      }

      if (rolSolicitado === null) {
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
      
      return res.status(201).json({
        mensaje: "Usuario registrado correctamente",
        usuario: creado.rows[0],
      });

    } catch (error) {
      console.error(error);
      return res.status(500).json({ mensaje: "Error al registrar usuario" });
    }
  });

  // Logout
  router.post("/logout", (req, res) => {
    req.session.destroy(() => {
      res.redirect("/login");
    });
  });

  return router;
}

module.exports = createLoginRouter;
