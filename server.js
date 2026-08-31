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
