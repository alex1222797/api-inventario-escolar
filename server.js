const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();

app.use(bodyParser.json());
app.use(cors());


// =====================================================
// CONEXIÓN A AIVEN MYSQL
// =====================================================
//
// process.env significa:
// "busca este dato en las variables de entorno".
//
// En Render pondremos las credenciales de Aiven.
// Así NO publicamos contraseñas en GitHub.
//

const conexion = mysql.createConnection({

    // Dirección del servidor MySQL de Aiven
    host: process.env.DB_HOST,

    // Usuario de Aiven, normalmente avnadmin
    user: process.env.DB_USER,

    // Contraseña de Aiven
    password: process.env.DB_PASSWORD,

    // Aquí pondremos inventario_db
    database: process.env.DB_NAME,

    // Puerto que proporciona Aiven
    port: process.env.DB_PORT,

    // Aiven utiliza conexión SSL
    ssl: {
        rejectUnauthorized: false
    }
});


// =====================================================
// PROBAR CONEXIÓN
// =====================================================

conexion.connect((err) => {

    if (err) {
        console.error("Error al conectar con Aiven:", err);
        return;
    }

    console.log("Conectado correctamente a Aiven MySQL");
});


// =====================================================
// RUTA PRINCIPAL
// =====================================================
//
// Esta ruta nos servirá para comprobar desde el
// navegador que Render está ejecutando nuestra API.
//

app.get("/", (req, res) => {

    res.json({
        status: "ok",
        mensaje: "Inventario API funcionando"
    });

});


// =====================================================
// REGISTRAR MATERIAL
// =====================================================
//
// POST se utiliza porque estamos creando un registro.
//

app.post("/materiales", (req, res) => {

    // Desestructuración:
    // extraemos los valores enviados por Flutter.
    const { nombre, cantidad, estado } = req.body;

    const sql = `
        INSERT INTO materiales
        (nombre, cantidad, estado)
        VALUES (?, ?, ?)
    `;

    // Los ? son reemplazados por estos valores.
    // Esto es preferible a concatenar valores en el SQL.
    conexion.query(
        sql,
        [nombre, cantidad, estado],
        (err, result) => {

            if (err) {

                console.error("Error registrando material:", err);

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error al registrar material"
                });
            }

            res.json({
                status: "ok",
                mensaje: "Material registrado",
                id: result.insertId
            });
        }
    );
});


// =====================================================
// LOGIN
// =====================================================

app.post("/login", (req, res) => {

    // Recibimos usuario y contraseña desde Flutter.
    const { usuario, clave } = req.body;

    // Validamos que Flutter realmente los haya enviado.
    if (!usuario || !clave) {

        return res.status(400).json({
            status: "fail",
            mensaje: "Usuario y contraseña son obligatorios"
        });
    }

    const sql = `
        SELECT id, usuario, rol
        FROM usuarios
        WHERE usuario = ?
        AND clave = ?
        LIMIT 1
    `;

    conexion.query(
        sql,
        [usuario, clave],
        (err, result) => {

            if (err) {

                console.error("Error en login:", err);

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error interno del servidor"
                });
            }

            // Si MySQL no encontró ningún usuario.
            if (result.length === 0) {

                return res.status(401).json({
                    status: "fail",
                    mensaje: "Credenciales incorrectas"
                });
            }

            // Primer usuario encontrado.
            const usuarioEncontrado = result[0];

            // Respondemos a Flutter.
            res.json({
                status: "ok",
                id: usuarioEncontrado.id,
                usuario: usuarioEncontrado.usuario,
                rol: usuarioEncontrado.rol
            });
        }
    );
});
app.post("/prestamos", (req, res) => {
  const {
    material_id,
    fecha_prestamo,
    fecha_devolucion,
    maestro
  } = req.body;

  if (!material_id || !fecha_prestamo || !maestro) {
    return res.status(400).json({
      status: "error",
      mensaje: "Faltan datos obligatorios"
    });
  }

  const sql = `
    INSERT INTO prestamos
    (material_id, fecha_prestamo, fecha_devolucion, maestro)
    VALUES (?, ?, ?, ?)
  `;

  conexion.query(
    sql,
    [material_id, fecha_prestamo, fecha_devolucion, maestro],
    (err, result) => {

      if (err) {
        return res.status(500).json({
          status: "error",
          mensaje: err.message
        });
      }

      res.json({
        status: "ok",
        mensaje: "Préstamo registrado",
        id: result.insertId
      });
    }
  );
});

// =====================================================
// INICIAR SERVIDOR
// =====================================================
//
// En nuestra PC usará 3000.
//
// En Render:
// process.env.PORT tendrá el puerto que Render
// asigne automáticamente.
//

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {

    console.log("--------------------------------");
    console.log(" INVENTARIO API");
    console.log("--------------------------------");
    console.log(`Servidor iniciado en puerto ${PORT}`);
    console.log("--------------------------------");

});
