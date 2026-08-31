// =====================================================
// IMPORTAR LIBRERÍAS
// =====================================================

const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");


// =====================================================
// CREAR APLICACIÓN EXPRESS
// =====================================================

const app = express();


// =====================================================
// MIDDLEWARES
// =====================================================

// Permite recibir datos JSON desde Flutter.
app.use(bodyParser.json());

// Permite peticiones desde otras aplicaciones.
app.use(cors());


// =====================================================
// CONEXIÓN A AIVEN MYSQL
// =====================================================
//
// process.env significa:
// "buscar este dato en las variables de entorno".
//
// Las credenciales estarán guardadas en Render.
// Así no publicamos contraseñas en GitHub.
//

const conexion = mysql.createConnection({

    // Host de Aiven.
    host: process.env.DB_HOST,

    // Usuario de Aiven.
    user: process.env.DB_USER,

    // Contraseña de Aiven.
    password: process.env.DB_PASSWORD,

    // Base de datos.
    database: process.env.DB_NAME,

    // Puerto de Aiven.
    port: Number(process.env.DB_PORT),

    // Aiven utiliza SSL.
    ssl: {
        rejectUnauthorized: false
    }
});


// =====================================================
// PROBAR CONEXIÓN A MYSQL
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
// Sirve para comprobar que la API está funcionando.
//

app.get("/", (req, res) => {

    return res.json({
        status: "ok",
        mensaje: "Inventario API funcionando"
    });

});


// =====================================================
// REGISTRAR MATERIAL
// =====================================================
//
// Flutter enviará:
//
// nombre
// cantidad
// estado
//

app.post("/materiales", (req, res) => {

    const {
        nombre,
        cantidad,
        estado
    } = req.body;


    // Validamos campos obligatorios.
    if (!nombre || cantidad === undefined || !estado) {

        return res.status(400).json({
            status: "error",
            mensaje: "Faltan datos obligatorios"
        });
    }


    const sql = `
        INSERT INTO materiales
        (nombre, cantidad, estado)
        VALUES (?, ?, ?)
    `;


    conexion.query(
        sql,
        [
            nombre,
            cantidad,
            estado
        ],
        (err, result) => {

            if (err) {

                console.error(
                    "Error registrando material:",
                    err
                );

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error al registrar material"
                });
            }


            return res.status(201).json({
                status: "ok",
                mensaje: "Material registrado",
                id: result.insertId
            });
        }
    );

});


// =====================================================
// OBTENER MATERIALES
// =====================================================
//
// Esta ruta servirá después para llenar un Dropdown
// en Flutter con los materiales disponibles.
//

app.get("/materiales", (req, res) => {

    const sql = `
        SELECT
            id,
            nombre,
            cantidad,
            estado
        FROM materiales
        ORDER BY nombre ASC
    `;


    conexion.query(
        sql,
        (err, result) => {

            if (err) {

                console.error(
                    "Error obteniendo materiales:",
                    err
                );

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error al obtener materiales"
                });
            }


            return res.json({
                status: "ok",
                materiales: result
            });
        }
    );

});


// =====================================================
// LOGIN
// =====================================================
//
// Flutter enviará:
//
// usuario
// clave
//

app.post("/login", (req, res) => {

    const {
        usuario,
        clave
    } = req.body;


    // Validamos los datos.
    if (!usuario || !clave) {

        return res.status(400).json({
            status: "fail",
            mensaje: "Usuario y contraseña son obligatorios"
        });
    }


    const sql = `
        SELECT
            id,
            usuario,
            rol
        FROM usuarios
        WHERE usuario = ?
        AND clave = ?
        LIMIT 1
    `;


    conexion.query(
        sql,
        [
            usuario,
            clave
        ],
        (err, result) => {

            if (err) {

                console.error(
                    "Error en login:",
                    err
                );

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error interno del servidor"
                });
            }


            // No se encontró el usuario.
            if (result.length === 0) {

                return res.status(401).json({
                    status: "fail",
                    mensaje: "Credenciales incorrectas"
                });
            }


            const usuarioEncontrado = result[0];


            return res.json({
                status: "ok",
                id: usuarioEncontrado.id,
                usuario: usuarioEncontrado.usuario,
                rol: usuarioEncontrado.rol
            });
        }
    );

});


// =====================================================
// REGISTRAR PRÉSTAMO
// =====================================================
//
// Flutter enviará:
//
// material_id
// fecha_prestamo
// fecha_devolucion
// maestro
//

app.post("/prestamos", (req, res) => {

    const {
        material_id,
        fecha_prestamo,
        fecha_devolucion,
        maestro
    } = req.body;


    // fecha_devolucion puede ser null.
    if (!material_id || !fecha_prestamo || !maestro) {

        return res.status(400).json({
            status: "error",
            mensaje: "Faltan datos obligatorios"
        });
    }


    const sql = `
        INSERT INTO prestamos
        (
            material_id,
            fecha_prestamo,
            fecha_devolucion,
            maestro
        )
        VALUES (?, ?, ?, ?)
    `;


    conexion.query(
        sql,
        [
            material_id,
            fecha_prestamo,
            fecha_devolucion || null,
            maestro
        ],
        (err, result) => {

            if (err) {

                console.error(
                    "Error registrando préstamo:",
                    err
                );

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error al registrar préstamo"
                });
            }


            return res.status(201).json({
                status: "ok",
                mensaje: "Préstamo registrado",
                id: result.insertId
            });
        }
    );

});


// =====================================================
// OBTENER PRÉSTAMOS
// =====================================================
//
// Devuelve los préstamos registrados junto con
// el nombre del material.
//

app.get("/prestamos", (req, res) => {

    const sql = `
        SELECT
            p.id,
            p.material_id,
            m.nombre AS material,
            p.fecha_prestamo,
            p.fecha_devolucion,
            p.maestro
        FROM prestamos p
        INNER JOIN materiales m
            ON p.material_id = m.id
        ORDER BY p.id DESC
    `;


    conexion.query(
        sql,
        (err, result) => {

            if (err) {

                console.error(
                    "Error obteniendo préstamos:",
                    err
                );

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error al obtener préstamos"
                });
            }


            return res.json({
                status: "ok",
                prestamos: result
            });
        }
    );

});


// =====================================================
// RUTA NO ENCONTRADA
// =====================================================

app.use((req, res) => {

    return res.status(404).json({
        status: "error",
        mensaje: "Ruta no encontrada"
    });

});



// =====================================================
// INICIAR SERVIDOR
// =====================================================
//
// En la PC:
// puerto 3000.
//
// En Render:
// process.env.PORT tendrá el puerto asignado,
// normalmente 10000.
//

const PORT = process.env.PORT || 3000;


app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log("--------------------------------");
        console.log(" INVENTARIO API");
        console.log("--------------------------------");
        console.log(`Servidor iniciado en puerto ${PORT}`);
        console.log("--------------------------------");

    }
);
