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

app.use(bodyParser.json());
app.use(cors());


// =====================================================
// CONEXIÓN A AIVEN MYSQL
// =====================================================

const conexion = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT),

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

app.get("/", (req, res) => {
    return res.json({
        status: "ok",
        mensaje: "Inventario API funcionando"
    });
});


// =====================================================
// REGISTRAR MATERIAL
// =====================================================

app.post("/materiales", (req, res) => {
    const {
        nombre,
        cantidad,
        estado
    } = req.body;

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

    conexion.query(sql, (err, result) => {
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
    });
});


// =====================================================
// LOGIN
// =====================================================

app.post("/login", (req, res) => {
    const {
        usuario,
        clave
    } = req.body;

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
// OBTENER PRÉSTAMOS CON NOMBRE DEL MATERIAL
// =====================================================

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

    conexion.query(sql, (err, result) => {
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
    });
});


// =====================================================
// ACTUALIZAR FECHA DE DEVOLUCIÓN
// =====================================================
//
// Ejemplo:
// PUT /prestamos/1
//
// Body:
// {
//     "fecha_devolucion": "2026-08-31 15:30:00"
// }
//

app.put("/prestamos/:id", (req, res) => {
    const {
        fecha_devolucion
    } = req.body;

    const idPrestamo = Number(req.params.id);

    if (!Number.isInteger(idPrestamo) || idPrestamo <= 0) {
        return res.status(400).json({
            status: "error",
            mensaje: "El ID del préstamo no es válido"
        });
    }

    if (!fecha_devolucion) {
        return res.status(400).json({
            status: "error",
            mensaje: "La fecha de devolución es obligatoria"
        });
    }

    const sql = `
        UPDATE prestamos
        SET fecha_devolucion = ?
        WHERE id = ?
    `;

    conexion.query(
        sql,
        [
            fecha_devolucion,
            idPrestamo
        ],
        (err, result) => {
            if (err) {
                console.error(
                    "Error actualizando préstamo:",
                    err
                );

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error al actualizar el préstamo"
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    status: "error",
                    mensaje: "Préstamo no encontrado"
                });
            }

            return res.json({
                status: "ok",
                mensaje: "Préstamo actualizado"
            });
        }
    );
});


// =====================================================
// MARCAR MATERIAL COMO DEVUELTO
// =====================================================
//
// Ejemplo:
// PUT /prestamos/devolver/1
//
// No necesita body.
// MySQL colocará automáticamente la fecha y hora actual.
//

app.put("/prestamos/devolver/:id", (req, res) => {
    const idPrestamo = Number(req.params.id);

    if (!Number.isInteger(idPrestamo) || idPrestamo <= 0) {
        return res.status(400).json({
            status: "error",
            mensaje: "El ID del préstamo no es válido"
        });
    }

    const sql = `
        UPDATE prestamos
        SET fecha_devolucion = NOW()
        WHERE id = ?
    `;

    conexion.query(
        sql,
        [idPrestamo],
        (err, result) => {
            if (err) {
                console.error(
                    "Error marcando devolución:",
                    err
                );

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error al marcar la devolución"
                });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({
                    status: "error",
                    mensaje: "Préstamo no encontrado"
                });
            }

            return res.json({
                status: "ok",
                mensaje: "Material devuelto"
            });
        }
    );
});

// =====================================================
// REPORTE: TOTAL DE PRÉSTAMOS
// =====================================================

// Creamos una ruta HTTP GET.
// Su dirección completa será:
// https://restaurante-api-con-node.onrender.com/reportes/total
app.get("/reportes/total", (req, res) => {

    // COUNT(*) cuenta todos los registros de la tabla préstamos.
    // AS total cambia el nombre de la columna resultante a "total".
    const sql = `
        SELECT COUNT(*) AS total
        FROM prestamos
    `;

    // Enviamos la consulta SQL a la base de datos.
    conexion.query(sql, (err, result) => {

        // Si MySQL devuelve un error, entramos en este bloque.
        if (err) {

            // Mostramos el error real solamente en la consola de Render.
            console.error(
                "Error obteniendo total de préstamos:",
                err
            );

            // Respondemos con código HTTP 500 porque ocurrió
            // un error interno en el servidor.
            return res.status(500).json({
                status: "error",
                mensaje: "Error al obtener el total de préstamos"
            });
        }

        // result es un arreglo parecido a:
        // [{ total: 10 }]
        //
        // Por eso utilizamos result[0] para obtener el primer objeto
        // y result[0].total para obtener únicamente el número.
        return res.status(200).json({
            status: "ok",
            total: result[0].total
        });
    });
});


// =====================================================
// REPORTE: PRÉSTAMOS PENDIENTES
// =====================================================

// Esta ruta contará los préstamos que todavía
// no tienen una fecha de devolución.
app.get("/reportes/pendientes", (req, res) => {

    // IS NULL busca registros cuyo campo fecha_devolucion
    // todavía no contiene ninguna fecha.
    //
    // AS pendientes hace que el resultado se llame "pendientes".
    const sql = `
        SELECT COUNT(*) AS pendientes
        FROM prestamos
        WHERE fecha_devolucion IS NULL
    `;

    // Ejecutamos la consulta en MySQL.
    conexion.query(sql, (err, result) => {

        // Comprobamos si ocurrió algún error.
        if (err) {

            // Guardamos el error técnico en la consola del servidor.
            console.error(
                "Error obteniendo préstamos pendientes:",
                err
            );

            // Enviamos una respuesta segura para Flutter.
            return res.status(500).json({
                status: "error",
                mensaje: "Error al obtener los préstamos pendientes"
            });
        }

        // MySQL devuelve:
        // [{ pendientes: 4 }]
        //
        // Extraemos el número usando result[0].pendientes.
        return res.status(200).json({
            status: "ok",
            pendientes: result[0].pendientes
        });
    });
});


// =====================================================
// REPORTE: PRÉSTAMOS DEVUELTOS
// =====================================================

// Esta ruta contará los préstamos que ya tienen
// una fecha de devolución registrada.
app.get("/reportes/devueltos", (req, res) => {

    // IS NOT NULL significa que fecha_devolucion
    // sí contiene una fecha.
    //
    // AS devueltos asigna un nombre al resultado.
    const sql = `
        SELECT COUNT(*) AS devueltos
        FROM prestamos
        WHERE fecha_devolucion IS NOT NULL
    `;

    // Ejecutamos la consulta en la conexión de Aiven.
    conexion.query(sql, (err, result) => {

        // Comprobamos si MySQL produjo un error.
        if (err) {

            // El error técnico aparece en los logs de Render.
            console.error(
                "Error obteniendo préstamos devueltos:",
                err
            );

            // Respondemos con código 500 y un mensaje entendible.
            return res.status(500).json({
                status: "error",
                mensaje: "Error al obtener los préstamos devueltos"
            });
        }

        // MySQL devuelve:
        // [{ devueltos: 6 }]
        //
        // Tomamos el primer resultado y enviamos su valor.
        return res.status(200).json({
            status: "ok",
            devueltos: result[0].devueltos
        });
    });
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log("--------------------------------");
    console.log(" INVENTARIO API");
    console.log("--------------------------------");
    console.log(`Servidor iniciado en puerto ${PORT}`);
    console.log("--------------------------------");
});
