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
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();

const JWT_SECRET =
    process.env.JWT_SECRET || "clave_secreta_inventario_stockify";

// =====================================================
// MIDDLEWARES
// =====================================================

app.use(bodyParser.json());
app.use(cors());

function verificarToken(req, res, next) {
    const authorization = req.headers.authorization || "";

    const token = authorization.startsWith("Bearer ")
        ? authorization.substring(7)
        : authorization;

    if (!token) {
        return res.status(401).json({
            status: "error",
            mensaje: "Token requerido"
        });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({
                status: "error",
                mensaje: "Token inválido o vencido"
            });
        }

        req.usuario = decoded;
        next();
    });
}

function soloAdministrador(req, res, next) {
    if (req.usuario.rol !== "administrador") {
        return res.status(403).json({
            status: "error",
            mensaje: "Acceso exclusivo para administradores"
        });
    }

    next();
}

// =====================================================
// CONFIGURACIÓN DE CÓDIGOS QR
// =====================================================

const carpetaQR = path.join(__dirname, "qrs");

if (!fs.existsSync(carpetaQR)) {
    fs.mkdirSync(carpetaQR, { recursive: true });
}

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
            console.error("Error consultando material:", err);

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
// GUÍA 13: REGISTRAR USUARIO SEGURO
// Usa usuarios(id, usuario, clave, rol)
// =====================================================

app.post("/registro", (req, res) => {
    const {
        usuario,
        clave,
        rol
    } = req.body;

    if (!usuario || !clave) {
        return res.status(400).json({
            status: "fail",
            mensaje: "Usuario y contraseña son obligatorios"
        });
    }

    const usuarioLimpio = String(usuario).trim();
    const rolFinal = rol || "maestro";

    if (!["administrador", "maestro"].includes(rolFinal)) {
        return res.status(400).json({
            status: "fail",
            mensaje: "El rol debe ser administrador o maestro"
        });
    }

    const sqlBuscar = `
        SELECT id
        FROM usuarios
        WHERE usuario = ?
        LIMIT 1
    `;

    conexion.query(
        sqlBuscar,
        [usuarioLimpio],
        async (err, result) => {
            if (err) {
                console.error("Error buscando usuario:", err);

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error interno del servidor"
                });
            }

            if (result.length > 0) {
                return res.status(409).json({
                    status: "fail",
                    mensaje: "Ese nombre de usuario ya existe"
                });
            }

            try {
                const claveCifrada = await bcrypt.hash(
                    String(clave),
                    10
                );

                const sqlRegistrar = `
                    INSERT INTO usuarios
                    (usuario, clave, rol)
                    VALUES (?, ?, ?)
                `;

                conexion.query(
                    sqlRegistrar,
                    [
                        usuarioLimpio,
                        claveCifrada,
                        rolFinal
                    ],
                    (errorRegistro, resultadoRegistro) => {
                        if (errorRegistro) {
                            console.error(
                                "Error registrando usuario:",
                                errorRegistro
                            );

                            return res.status(500).json({
                                status: "error",
                                mensaje:
                                    "No se pudo registrar el usuario"
                            });
                        }

                        return res.status(201).json({
                            status: "ok",
                            mensaje: "Usuario registrado",
                            id: resultadoRegistro.insertId
                        });
                    }
                );
            } catch (error) {
                console.error(
                    "Error cifrando contraseña:",
                    error
                );

                return res.status(500).json({
                    status: "error",
                    mensaje: "No se pudo registrar el usuario"
                });
            }
        }
    );
});

// =====================================================
// GUÍA 13: LOGIN CON BCRYPT Y JWT
// Migra automáticamente claves antiguas como 1234.
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
            clave,
            rol
        FROM usuarios
        WHERE usuario = ?
        LIMIT 1
    `;

    conexion.query(
        sql,
        [String(usuario).trim()],
        async (err, result) => {
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
            const claveGuardada =
                String(usuarioEncontrado.clave);

            const estaCifrada =
                claveGuardada.startsWith("$2a$") ||
                claveGuardada.startsWith("$2b$") ||
                claveGuardada.startsWith("$2y$");

            try {
                const claveCorrecta = estaCifrada
                    ? await bcrypt.compare(
                        String(clave),
                        claveGuardada
                    )
                    : String(clave) === claveGuardada;

                if (!claveCorrecta) {
                    return res.status(401).json({
                        status: "fail",
                        mensaje: "Credenciales incorrectas"
                    });
                }

                // Convierte claves antiguas en texto plano a bcrypt.
                if (!estaCifrada) {
                    const claveCifrada =
                        await bcrypt.hash(String(clave), 10);

                    conexion.query(
                        `
                            UPDATE usuarios
                            SET clave = ?
                            WHERE id = ?
                        `,
                        [
                            claveCifrada,
                            usuarioEncontrado.id
                        ],
                        (errorActualizar) => {
                            if (errorActualizar) {
                                console.error(
                                    "No se pudo cifrar la clave:",
                                    errorActualizar
                                );
                            }
                        }
                    );
                }

                const token = jwt.sign(
                    {
                        id: usuarioEncontrado.id,
                        usuario:
                            usuarioEncontrado.usuario,
                        rol: usuarioEncontrado.rol
                    },
                    JWT_SECRET,
                    {
                        expiresIn: "1h"
                    }
                );

                return res.status(200).json({
                    status: "ok",
                    token,
                    id: usuarioEncontrado.id,
                    usuario:
                        usuarioEncontrado.usuario,
                    rol: usuarioEncontrado.rol
                });
            } catch (error) {
                console.error(
                    "Error validando contraseña:",
                    error
                );

                return res.status(500).json({
                    status: "error",
                    mensaje: "No se pudo iniciar sesión"
                });
            }
        }
    );
});

// =====================================================
// RUTA PROTEGIDA PARA ADMINISTRADORES
// =====================================================

app.get(
    "/admin/reportes",
    verificarToken,
    soloAdministrador,
    (req, res) => {
        return res.status(200).json({
            status: "ok",
            mensaje: "Bienvenido administrador",
            usuario: req.usuario.usuario
        });
    }
);

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

    const maestroLimpio = String(maestro).trim();

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
        [
            maestroLimpio,
            material_id
        ],
        (errPermiso, permisos) => {
            if (errPermiso) {
                console.error(
                    "Error consultando permisos:",
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
                mensaje: "Préstamo no encontrado o ya fue devuelto"
            });
        }

        return res.status(200).json({
            status: "ok",
            mensaje: "Material devuelto"
        });
    });
});

// =====================================================
// DEVOLVER MATERIAL MEDIANTE QR
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
            [
                maestro,
                materialId
            ],
            (errPermiso, permisos) => {
                if (errPermiso) {
                    console.error(
                        "Error consultando permisos:",
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
                    [
                        materialId,
                        maestro
                    ],
                    (errorEntrega, result) => {
                        if (errorEntrega) {
                            console.error(
                                "Error registrando entrega:",
                                errorEntrega
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
                mensaje: "Error al obtener las notificaciones"
            });
        }

        return res.status(200).json(result);
    });
});

// =====================================================
// FUNCIONES PARA REPORTES FILTRADOS
// =====================================================

function obtenerFiltrosReporte(req) {
    return {
        maestro:
            req.query.maestro?.toString().trim() || "",

        fechaInicio:
            req.query.fecha_inicio?.toString().trim() || "",

        fechaFin:
            req.query.fecha_fin?.toString().trim() || ""
    };
}

function validarFiltrosReporte(filtros) {
    const formatoFecha = /^\d{4}-\d{2}-\d{2}$/;

    if (
        filtros.fechaInicio &&
        !formatoFecha.test(filtros.fechaInicio)
    ) {
        return "La fecha inicial debe usar el formato AAAA-MM-DD";
    }

    if (
        filtros.fechaFin &&
        !formatoFecha.test(filtros.fechaFin)
    ) {
        return "La fecha final debe usar el formato AAAA-MM-DD";
    }

    if (
        filtros.fechaInicio &&
        filtros.fechaFin &&
        filtros.fechaInicio > filtros.fechaFin
    ) {
        return "La fecha inicial no puede ser posterior a la fecha final";
    }

    return null;
}

function construirConsultaReporte(filtros) {
    let sql = `
        SELECT
            p.id,
            p.material_id,
            m.nombre AS material,
            p.maestro,
            p.fecha_prestamo,
            p.fecha_devolucion,

            CASE
                WHEN p.fecha_devolucion IS NULL
                    THEN 'Pendiente'
                ELSE 'Devuelto'
            END AS estado

        FROM prestamos p

        INNER JOIN materiales m
            ON p.material_id = m.id

        WHERE 1 = 1
    `;

    const parametros = [];

    if (filtros.maestro) {
        sql += " AND p.maestro = ?";
        parametros.push(filtros.maestro);
    }

    if (filtros.fechaInicio) {
        sql += " AND DATE(p.fecha_prestamo) >= ?";
        parametros.push(filtros.fechaInicio);
    }

    if (filtros.fechaFin) {
        sql += " AND DATE(p.fecha_prestamo) <= ?";
        parametros.push(filtros.fechaFin);
    }

    sql += `
        ORDER BY p.fecha_prestamo DESC, p.id DESC
    `;

    return {
        sql,
        parametros
    };
}

function mostrarFechaReporte(valor) {
    if (!valor) {
        return "Pendiente";
    }

    const fecha = new Date(valor);

    if (Number.isNaN(fecha.getTime())) {
        return String(valor);
    }

    const dia =
        String(fecha.getDate()).padStart(2, "0");

    const mes =
        String(fecha.getMonth() + 1).padStart(2, "0");

    const anio =
        fecha.getFullYear();

    const hora =
        String(fecha.getHours()).padStart(2, "0");

    const minuto =
        String(fecha.getMinutes()).padStart(2, "0");

    return `${dia}/${mes}/${anio} ${hora}:${minuto}`;
}

// =====================================================
// REPORTE FILTRADO EN JSON
// =====================================================

app.get("/reportes/filtrados", (req, res) => {
    const filtros = obtenerFiltrosReporte(req);
    const errorFiltros =
        validarFiltrosReporte(filtros);

    if (errorFiltros) {
        return res.status(400).json({
            status: "fail",
            mensaje: errorFiltros
        });
    }

    const consulta =
        construirConsultaReporte(filtros);

    conexion.query(
        consulta.sql,
        consulta.parametros,
        (err, result) => {
            if (err) {
                console.error(
                    "Error obteniendo reporte:",
                    err
                );

                return res.status(500).json({
                    status: "error",
                    mensaje:
                        "Error al obtener el reporte filtrado"
                });
            }

            return res.status(200).json({
                status: "ok",
                filtros,
                total: result.length,
                prestamos: result
            });
        }
    );
});

// =====================================================
// EXPORTAR REPORTE A PDF
// =====================================================

app.get("/reportes/pdf", (req, res) => {
    const filtros = obtenerFiltrosReporte(req);
    const errorFiltros =
        validarFiltrosReporte(filtros);

    if (errorFiltros) {
        return res.status(400).json({
            status: "fail",
            mensaje: errorFiltros
        });
    }

    const consulta =
        construirConsultaReporte(filtros);

    conexion.query(
        consulta.sql,
        consulta.parametros,
        (err, prestamos) => {
            if (err) {
                console.error(
                    "Error generando reporte PDF:",
                    err
                );

                return res.status(500).json({
                    status: "error",
                    mensaje:
                        "Error al generar el reporte PDF"
                });
            }

            res.setHeader(
                "Content-Type",
                "application/pdf"
            );

            res.setHeader(
                "Content-Disposition",
                'attachment; filename="reporte_prestamos.pdf"'
            );

            const documento =
                new PDFDocument({
                    size: "A4",
                    margin: 45
                });

            documento.pipe(res);

            documento
                .font("Helvetica-Bold")
                .fontSize(20)
                .fillColor("#0F7A8C")
                .text(
                    "Inventario Escolar",
                    {
                        align: "center"
                    }
                );

            documento
                .fontSize(16)
                .text(
                    "Reporte filtrado de préstamos",
                    {
                        align: "center"
                    }
                );

            documento.moveDown();

            documento
                .font("Helvetica")
                .fontSize(10)
                .fillColor("#222222");

            documento.text(
                `Maestro: ${filtros.maestro || "Todos"}`
            );

            documento.text(
                `Fecha inicial: ${
                    filtros.fechaInicio || "Sin filtro"
                }`
            );

            documento.text(
                `Fecha final: ${
                    filtros.fechaFin || "Sin filtro"
                }`
            );

            documento.text(
                `Total de registros: ${prestamos.length}`
            );

            documento.moveDown();

            if (prestamos.length === 0) {
                documento.text(
                    "No se encontraron préstamos con estos filtros."
                );
            }

            prestamos.forEach(
                (prestamo, index) => {
                    if (
                        documento.y >
                        documento.page.height - 145
                    ) {
                        documento.addPage();
                    }

                    documento
                        .font("Helvetica-Bold")
                        .fontSize(12)
                        .fillColor("#0F7A8C")
                        .text(
                            `${index + 1}. ${prestamo.material}`
                        );

                    documento
                        .font("Helvetica")
                        .fontSize(10)
                        .fillColor("#222222");

                    documento.text(
                        `Préstamo ID: ${prestamo.id}`
                    );

                    documento.text(
                        `Material ID: ${prestamo.material_id}`
                    );

                    documento.text(
                        `Maestro: ${prestamo.maestro}`
                    );

                    documento.text(
                        `Fecha préstamo: ${
                            mostrarFechaReporte(
                                prestamo.fecha_prestamo
                            )
                        }`
                    );

                    documento.text(
                        `Fecha devolución: ${
                            mostrarFechaReporte(
                                prestamo.fecha_devolucion
                            )
                        }`
                    );

                    documento.text(
                        `Estado: ${prestamo.estado}`
                    );

                    documento.moveDown();
                }
            );

            documento.end();
        }
    );
});

// =====================================================
// EXPORTAR REPORTE A EXCEL
// =====================================================

app.get("/reportes/excel", (req, res) => {
    const filtros = obtenerFiltrosReporte(req);
    const errorFiltros =
        validarFiltrosReporte(filtros);

    if (errorFiltros) {
        return res.status(400).json({
            status: "fail",
            mensaje: errorFiltros
        });
    }

    const consulta =
        construirConsultaReporte(filtros);

    conexion.query(
        consulta.sql,
        consulta.parametros,
        async (err, prestamos) => {
            if (err) {
                console.error(
                    "Error generando Excel:",
                    err
                );

                return res.status(500).json({
                    status: "error",
                    mensaje:
                        "Error al generar el reporte Excel"
                });
            }

            try {
                const libro =
                    new ExcelJS.Workbook();

                libro.creator =
                    "Inventario Escolar";

                libro.created =
                    new Date();

                const hoja =
                    libro.addWorksheet("Préstamos");

                hoja.columns = [
                    {
                        header: "ID",
                        key: "id",
                        width: 10
                    },
                    {
                        header: "Material ID",
                        key: "material_id",
                        width: 14
                    },
                    {
                        header: "Material",
                        key: "material",
                        width: 28
                    },
                    {
                        header: "Maestro",
                        key: "maestro",
                        width: 22
                    },
                    {
                        header: "Fecha préstamo",
                        key: "fecha_prestamo",
                        width: 22
                    },
                    {
                        header: "Fecha devolución",
                        key: "fecha_devolucion",
                        width: 22
                    },
                    {
                        header: "Estado",
                        key: "estado",
                        width: 15
                    }
                ];

                prestamos.forEach((prestamo) => {
                    hoja.addRow({
                        id:
                            prestamo.id,

                        material_id:
                            prestamo.material_id,

                        material:
                            prestamo.material,

                        maestro:
                            prestamo.maestro,

                        fecha_prestamo:
                            mostrarFechaReporte(
                                prestamo.fecha_prestamo
                            ),

                        fecha_devolucion:
                            mostrarFechaReporte(
                                prestamo.fecha_devolucion
                            ),

                        estado:
                            prestamo.estado
                    });
                });

                const encabezado =
                    hoja.getRow(1);

                encabezado.font = {
                    bold: true,
                    color: {
                        argb: "FFFFFFFF"
                    }
                };

                encabezado.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: {
                        argb: "FF17A6B8"
                    }
                };

                encabezado.alignment = {
                    vertical: "middle",
                    horizontal: "center"
                };

                hoja.autoFilter = {
                    from: "A1",
                    to: "G1"
                };

                res.setHeader(
                    "Content-Type",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                );

                res.setHeader(
                    "Content-Disposition",
                    'attachment; filename="reporte_prestamos.xlsx"'
                );

                await libro.xlsx.write(res);

                return res.end();
            } catch (errorExcel) {
                console.error(
                    "Error creando Excel:",
                    errorExcel
                );

                if (!res.headersSent) {
                    return res.status(500).json({
                        status: "error",
                        mensaje:
                            "Error al crear el archivo Excel"
                    });
                }

                return res.end();
            }
        }
    );
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
            return res.status(500).json({
                status: "error",
                mensaje:
                    "Error al obtener los préstamos pendientes"
            });
        }

        return res.status(200).json({
            status: "ok",
            pendientes:
                result[0].pendientes
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
            return res.status(500).json({
                status: "error",
                mensaje:
                    "Error al obtener los préstamos devueltos"
            });
        }

        return res.status(200).json({
            status: "ok",
            devueltos:
                result[0].devueltos
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

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    "0.0.0.0",
    () => {
        console.log("--------------------------------");
        console.log(" INVENTARIO API");
        console.log("--------------------------------");
        console.log(
            `Servidor iniciado en puerto ${PORT}`
        );
        console.log("--------------------------------");
    }
);
