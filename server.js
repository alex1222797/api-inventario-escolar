// =====================================================
// IMPORTAR LIBRERÍAS
// =====================================================

const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

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
// CONFIGURACIÓN DE CÓDIGOS QR
// =====================================================

const carpetaQR = path.join(__dirname, "qrs");

if (!fs.existsSync(carpetaQR)) {
    fs.mkdirSync(carpetaQR, { recursive: true });
}

// Permite abrir los códigos QR desde Render.
app.use("/qrs", express.static(carpetaQR));

async function generarQR(materialId) {
    const nombreArchivo = `${materialId}.png`;
    const ruta = path.join(carpetaQR, nombreArchivo);

    await QRCode.toFile(ruta, String(materialId), {
        color: {
            dark: "#000000",
            light: "#FFFFFF"
        },
        margin: 2,
        width: 300
    });

    console.log(`QR generado en: ${ruta}`);

    return {
        nombreArchivo,
        ruta
    };
}

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

app.get("/", (req, res) => {
    return res.json({
        status: "ok",
        mensaje: "Inventario API funcionando"
    });
});

// =====================================================
// REGISTRAR MATERIAL Y GENERAR QR
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
        [nombre, cantidad, estado],
        async (err, result) => {
            if (err) {
                console.error("Error registrando material:", err);

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error al registrar material"
                });
            }

            try {
                const qr = await generarQR(result.insertId);

                const qrUrl =
                    `${req.protocol}://${req.get("host")}/qrs/${qr.nombreArchivo}`;

                return res.status(201).json({
                    status: "ok",
                    mensaje: "Material registrado y QR generado",
                    id: result.insertId,
                    qr_url: qrUrl
                });
            } catch (errorQR) {
                console.error("Error generando QR:", errorQR);

                return res.status(201).json({
                    status: "ok",
                    mensaje:
                        "Material registrado, pero no se pudo generar el QR",
                    id: result.insertId
                });
            }
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
            console.error("Error obteniendo materiales:", err);

            return res.status(500).json({
                status: "error",
                mensaje: "Error al obtener materiales"
            });
        }

        return res.status(200).json({
            status: "ok",
            materiales: result
        });
    });
});

// =====================================================
// GENERAR O CONSULTAR QR DE UN MATERIAL
// =====================================================
// Ejemplo:
// GET /materiales/13/qr

app.get("/materiales/:id/qr", (req, res) => {
    const materialId = Number(req.params.id);

    if (!Number.isInteger(materialId) || materialId <= 0) {
        return res.status(400).json({
            status: "error",
            mensaje: "El ID del material no es válido"
        });
    }

    const sql = `
        SELECT id
        FROM materiales
        WHERE id = ?
        LIMIT 1
    `;

    conexion.query(sql, [materialId], async (err, result) => {
        if (err) {
            console.error("Error consultando material para QR:", err);

            return res.status(500).json({
                status: "error",
                mensaje: "Error al consultar el material"
            });
        }

        if (result.length === 0) {
            return res.status(404).json({
                status: "error",
                mensaje: "Material no encontrado"
            });
        }

        try {
            const qr = await generarQR(materialId);

            return res.sendFile(qr.ruta);
        } catch (errorQR) {
            console.error("Error generando QR:", errorQR);

            return res.status(500).json({
                status: "error",
                mensaje: "No se pudo generar el código QR"
            });
        }
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
        [usuario, clave],
        (err, result) => {
            if (err) {
                console.error("Error en login:", err);

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

            return res.status(200).json({
                status: "ok",
                id: usuarioEncontrado.id,
                usuario: usuarioEncontrado.usuario,
                rol: usuarioEncontrado.rol
            });
        }
    );
});

// =====================================================
// ASIGNAR PERMISOS
// =====================================================

app.post("/permisos", (req, res) => {
    const {
        maestro,
        material_id,
        puede_ver,
        puede_prestar,
        puede_devolver
    } = req.body;

    if (!maestro || !material_id) {
        return res.status(400).json({
            status: "error",
            mensaje: "El maestro y el material son obligatorios"
        });
    }

    const sql = `
        INSERT INTO permisos
        (
            maestro,
            material_id,
            puede_ver,
            puede_prestar,
            puede_devolver
        )
        VALUES (?, ?, ?, ?, ?)
    `;

    conexion.query(
        sql,
        [
            maestro,
            material_id,
            puede_ver,
            puede_prestar,
            puede_devolver
        ],
        (err, result) => {
            if (err) {
                console.error("Error asignando permiso:", err);

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error al asignar el permiso"
                });
            }

            return res.status(201).json({
                status: "ok",
                mensaje: "Permiso asignado",
                id: result.insertId
            });
        }
    );
});

// =====================================================
// REGISTRAR PRÉSTAMO VALIDANDO PERMISOS
// =====================================================

app.post("/prestamos", (req, res) => {
    const {
        material_id,
        fecha_prestamo,
        maestro
    } = req.body;

    if (!material_id || !fecha_prestamo || !maestro) {
        return res.status(400).json({
            status: "error",
            mensaje: "Faltan datos obligatorios"
        });
    }

    const maestroLimpio = maestro.trim();

    const sqlPermiso = `
        SELECT id
        FROM permisos
        WHERE maestro = ?
        AND material_id = ?
        AND puede_prestar = TRUE
        LIMIT 1
    `;

    conexion.query(
        sqlPermiso,
        [maestroLimpio, material_id],
        (errPermiso, permisos) => {
            if (errPermiso) {
                console.error(
                    "Error consultando permiso de préstamo:",
                    errPermiso
                );

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error al consultar los permisos"
                });
            }

            if (permisos.length === 0) {
                return res.status(403).json({
                    status: "fail",
                    mensaje:
                        "No tienes permiso para prestar este material"
                });
            }

            const sqlPrestamo = `
                INSERT INTO prestamos
                (
                    material_id,
                    fecha_prestamo,
                    maestro
                )
                VALUES (?, ?, ?)
            `;

            conexion.query(
                sqlPrestamo,
                [
                    material_id,
                    fecha_prestamo,
                    maestroLimpio
                ],
                (errPrestamo, result) => {
                    if (errPrestamo) {
                        console.error(
                            "Error registrando préstamo:",
                            errPrestamo
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
        }
    );
});

// =====================================================
// OBTENER PRÉSTAMOS
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
            console.error("Error obteniendo préstamos:", err);

            return res.status(500).json({
                status: "error",
                mensaje: "Error al obtener préstamos"
            });
        }

        return res.status(200).json({
            status: "ok",
            prestamos: result
        });
    });
});

// =====================================================
// DEVOLVER MEDIANTE ID DEL PRÉSTAMO
// =====================================================
// Esta ruta se conserva para ListaPrestamos de Flutter.

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
        AND fecha_devolucion IS NULL
    `;

    conexion.query(sql, [idPrestamo], (err, result) => {
        if (err) {
            console.error("Error marcando devolución:", err);

            return res.status(500).json({
                status: "error",
                mensaje: "Error al marcar la devolución"
            });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({
                status: "fail",
                mensaje:
                    "Préstamo no encontrado o ya fue devuelto"
            });
        }

        return res.status(200).json({
            status: "ok",
            mensaje: "Material devuelto"
        });
    });
});

// =====================================================
// ENTREGA MEDIANTE QR DEL MATERIAL
// =====================================================

app.put(
    "/prestamos/devolver-material/:material_id",
    (req, res) => {
        const materialId = Number(req.params.material_id);

        const maestro =
            req.body.maestro?.toString().trim();

        if (
            !Number.isInteger(materialId) ||
            materialId <= 0 ||
            !maestro
        ) {
            return res.status(400).json({
                status: "error",
                mensaje:
                    "El material y el maestro son obligatorios"
            });
        }

        const sqlPermiso = `
            SELECT id
            FROM permisos
            WHERE maestro = ?
            AND material_id = ?
            AND puede_devolver = TRUE
            LIMIT 1
        `;

        conexion.query(
            sqlPermiso,
            [maestro, materialId],
            (errPermiso, permisos) => {
                if (errPermiso) {
                    console.error(
                        "Error consultando permiso de devolución:",
                        errPermiso
                    );

                    return res.status(500).json({
                        status: "error",
                        mensaje:
                            "Error al consultar los permisos"
                    });
                }

                if (permisos.length === 0) {
                    return res.status(403).json({
                        status: "fail",
                        mensaje:
                            "No tienes permiso para devolver este material"
                    });
                }

                const sqlEntrega = `
                    UPDATE prestamos
                    SET fecha_devolucion = NOW()
                    WHERE material_id = ?
                    AND maestro = ?
                    AND fecha_devolucion IS NULL
                    ORDER BY id DESC
                    LIMIT 1
                `;

                conexion.query(
                    sqlEntrega,
                    [materialId, maestro],
                    (errEntrega, result) => {
                        if (errEntrega) {
                            console.error(
                                "Error registrando entrega mediante QR:",
                                errEntrega
                            );

                            return res.status(500).json({
                                status: "error",
                                mensaje:
                                    "Error al registrar la entrega"
                            });
                        }

                        if (result.affectedRows === 0) {
                            return res.status(404).json({
                                status: "fail",
                                mensaje:
                                    "No existe un préstamo pendiente para este material"
                            });
                        }

                        return res.status(200).json({
                            status: "ok",
                            mensaje:
                                "Entrega registrada mediante QR"
                        });
                    }
                );
            }
        );
    }
);

// =====================================================
// NOTIFICACIONES PENDIENTES POR MAESTRO
// =====================================================

app.get("/notificaciones/:maestro", (req, res) => {
    const maestro = req.params.maestro.trim();

    if (!maestro) {
        return res.status(400).json({
            status: "error",
            mensaje: "El nombre del maestro es obligatorio"
        });
    }

    const sql = `
        SELECT *
        FROM prestamos
        WHERE maestro = ?
        AND fecha_devolucion IS NULL
        ORDER BY fecha_prestamo ASC
    `;

    conexion.query(sql, [maestro], (err, result) => {
        if (err) {
            console.error(
                "Error obteniendo notificaciones:",
                err
            );

            return res.status(500).json({
                status: "error",
                mensaje:
                    "Error al obtener las notificaciones"
            });
        }

        return res.status(200).json(result);
    });
});

// =====================================================
// REPORTE: TOTAL DE PRÉSTAMOS
// =====================================================

app.get("/reportes/total", (req, res) => {
    const sql = `
        SELECT COUNT(*) AS total
        FROM prestamos
    `;

    conexion.query(sql, (err, result) => {
        if (err) {
            console.error(
                "Error obteniendo total de préstamos:",
                err
            );

            return res.status(500).json({
                status: "error",
                mensaje:
                    "Error al obtener el total de préstamos"
            });
        }

        return res.status(200).json({
            status: "ok",
            total: result[0].total
        });
    });
});

// =====================================================
// REPORTE: PRÉSTAMOS PENDIENTES
// =====================================================

app.get("/reportes/pendientes", (req, res) => {
    const sql = `
        SELECT COUNT(*) AS pendientes
        FROM prestamos
        WHERE fecha_devolucion IS NULL
    `;

    conexion.query(sql, (err, result) => {
        if (err) {
            console.error(
                "Error obteniendo préstamos pendientes:",
                err
            );

            return res.status(500).json({
                status: "error",
                mensaje:
                    "Error al obtener los préstamos pendientes"
            });
        }

        return res.status(200).json({
            status: "ok",
            pendientes: result[0].pendientes
        });
    });
});

// =====================================================
// REPORTE: PRÉSTAMOS DEVUELTOS
// =====================================================

app.get("/reportes/devueltos", (req, res) => {
    const sql = `
        SELECT COUNT(*) AS devueltos
        FROM prestamos
        WHERE fecha_devolucion IS NOT NULL
    `;

    conexion.query(sql, (err, result) => {
        if (err) {
            console.error(
                "Error obteniendo préstamos devueltos:",
                err
            );

            return res.status(500).json({
                status: "error",
                mensaje:
                    "Error al obtener los préstamos devueltos"
            });
        }

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
