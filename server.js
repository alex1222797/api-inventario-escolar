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

app.use(bodyParser.json());
app.use(cors());

// =====================================================
// VALIDACIÓN DE TOKEN
// =====================================================

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
// CONFIGURACIÓN DE QR
// =====================================================

const carpetaQR = path.join(__dirname, "qrs");

if (!fs.existsSync(carpetaQR)) {
    fs.mkdirSync(carpetaQR, {
        recursive: true
    });
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
// CONEXIÓN MYSQL AIVEN
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
// OBTENER MAESTROS PARA LISTAS DESPLEGABLES
// =====================================================

app.get("/maestros", (req, res) => {
    const sql = `
        SELECT
            id,
            usuario AS nombre,
            usuario
        FROM usuarios
        WHERE rol = 'maestro'
        ORDER BY usuario ASC
    `;

    conexion.query(sql, (err, result) => {
        if (err) {
            console.error("Error obteniendo maestros:", err);

            return res.status(500).json({
                status: "error",
                mensaje: "Error al obtener los maestros"
            });
        }

        return res.status(200).json({
            status: "ok",
            maestros: result
        });
    });
});

// =====================================================
// GENERAR O CONSULTAR QR
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
// REGISTRO DE USUARIOS
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
                                mensaje: "No se pudo registrar el usuario"
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
                console.error("Error cifrando contraseña:", error);

                return res.status(500).json({
                    status: "error",
                    mensaje: "No se pudo registrar el usuario"
                });
            }
        }
    );
});

// =====================================================
// LOGIN CON JWT
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
            const claveGuardada = String(usuarioEncontrado.clave);

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
                        usuario: usuarioEncontrado.usuario,
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
                    usuario: usuarioEncontrado.usuario,
                    rol: usuarioEncontrado.rol
                });
            } catch (error) {
                console.error("Error validando contraseña:", error);

                return res.status(500).json({
                    status: "error",
                    mensaje: "No se pudo iniciar sesión"
                });
            }
        }
    );
});

// =====================================================
// RUTA PROTEGIDA DE ADMINISTRADOR
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

    const sqlBuscar = `
        SELECT id
        FROM permisos
        WHERE maestro = ?
        AND material_id = ?
        LIMIT 1
    `;

    conexion.query(
        sqlBuscar,
        [String(maestro).trim(), material_id],
        (errorBuscar, permisos) => {
            if (errorBuscar) {
                console.error("Error consultando permiso:", errorBuscar);

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error al consultar el permiso"
                });
            }

            if (permisos.length > 0) {
                const sqlActualizar = `
                    UPDATE permisos
                    SET
                        puede_ver = ?,
                        puede_prestar = ?,
                        puede_devolver = ?
                    WHERE id = ?
                `;

                conexion.query(
                    sqlActualizar,
                    [
                        puede_ver,
                        puede_prestar,
                        puede_devolver,
                        permisos[0].id
                    ],
                    (errorActualizar) => {
                        if (errorActualizar) {
                            console.error(
                                "Error actualizando permiso:",
                                errorActualizar
                            );

                            return res.status(500).json({
                                status: "error",
                                mensaje: "Error al actualizar el permiso"
                            });
                        }

                        return res.status(200).json({
                            status: "ok",
                            mensaje: "Permiso actualizado"
                        });
                    }
                );

                return;
            }

            const sqlInsertar = `
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
                sqlInsertar,
                [
                    String(maestro).trim(),
                    material_id,
                    puede_ver,
                    puede_prestar,
                    puede_devolver
                ],
                (errorInsertar, result) => {
                    if (errorInsertar) {
                        console.error(
                            "Error asignando permiso:",
                            errorInsertar
                        );

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
        }
    );
});

// =====================================================
// REGISTRAR PRÉSTAMO
// ACEPTA maestro O docente_id PARA NO ROMPER FLUTTER
// =====================================================

app.post("/prestamos", (req, res) => {
    const {
        material_id,
        fecha_prestamo,
        maestro,
        docente_id
    } = req.body;

    if (!material_id || !fecha_prestamo || (!maestro && !docente_id)) {
        return res.status(400).json({
            status: "error",
            mensaje:
                "El material, la fecha y el maestro son obligatorios"
        });
    }

    const procesarPrestamo = (
        maestroFinal,
        docenteIdFinal
    ) => {
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
            [maestroFinal, material_id],
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
                        docente_id,
                        fecha_prestamo,
                        maestro
                    )
                    VALUES (?, ?, ?, ?)
                `;

                conexion.query(
                    sqlPrestamo,
                    [
                        material_id,
                        docenteIdFinal,
                        fecha_prestamo,
                        maestroFinal
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
    };

    if (docente_id) {
        const sqlDocente = `
            SELECT
                id,
                usuario
            FROM usuarios
            WHERE id = ?
            AND rol = 'maestro'
            LIMIT 1
        `;

        conexion.query(
            sqlDocente,
            [docente_id],
            (errorDocente, docentes) => {
                if (errorDocente) {
                    console.error(
                        "Error consultando docente:",
                        errorDocente
                    );

                    return res.status(500).json({
                        status: "error",
                        mensaje: "Error al consultar el docente"
                    });
                }

                if (docentes.length === 0) {
                    return res.status(404).json({
                        status: "fail",
                        mensaje: "Docente no encontrado"
                    });
                }

                procesarPrestamo(
                    docentes[0].usuario,
                    docentes[0].id
                );
            }
        );

        return;
    }

    const maestroLimpio = String(maestro).trim();

    const sqlMaestro = `
        SELECT id
        FROM usuarios
        WHERE usuario = ?
        AND rol = 'maestro'
        LIMIT 1
    `;

    conexion.query(
        sqlMaestro,
        [maestroLimpio],
        (errorMaestro, maestros) => {
            if (errorMaestro) {
                console.error(
                    "Error consultando maestro:",
                    errorMaestro
                );

                return res.status(500).json({
                    status: "error",
                    mensaje: "Error al consultar el maestro"
                });
            }

            const docenteIdFinal =
                maestros.length > 0 ? maestros[0].id : null;

            procesarPrestamo(
                maestroLimpio,
                docenteIdFinal
            );
        }
    );
});

// =====================================================
// GUÍA 15: PRÉSTAMOS CON NOMBRES
// =====================================================

app.get("/prestamos", (req, res) => {
    const sql = `
        SELECT
            p.id,
            p.material_id,
            m.nombre AS material,
            p.docente_id,

            COALESCE(
                u.usuario,
                p.maestro,
                'No especificado'
            ) AS docente,

            COALESCE(
                u.usuario,
                p.maestro,
                'No especificado'
            ) AS maestro,

            p.fecha_prestamo,
            p.fecha_devolucion

        FROM prestamos p

        INNER JOIN materiales m
            ON p.material_id = m.id

        LEFT JOIN usuarios u
            ON p.docente_id = u.id

        ORDER BY p.id DESC
    `;

    conexion.query(sql, (err, result) => {
        if (err) {
            console.error(
                "Error obteniendo préstamos con nombres:",
                err
            );

            return res.status(500).json({
                status: "error",
                mensaje: "Error al obtener los préstamos"
            });
        }

        return res.status(200).json({
            status: "ok",
            prestamos: result
        });
    });
});

// =====================================================
// DEVOLVER PRÉSTAMO POR ID
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
// DEVOLVER MEDIANTE QR
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
                    [materialId, maestro],
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
// NOTIFICACIONES DE PRÉSTAMOS PENDIENTES
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
        WHERE p.maestro = ?
        AND p.fecha_devolucion IS NULL
        ORDER BY p.fecha_prestamo ASC
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
// FUNCIONES PARA REPORTES
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

            COALESCE(
                u.usuario,
                p.maestro,
                'No especificado'
            ) AS maestro,

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

        LEFT JOIN usuarios u
            ON p.docente_id = u.id

        WHERE 1 = 1
    `;

    const parametros = [];

    if (filtros.maestro) {
        sql += `
            AND COALESCE(u.usuario, p.maestro) = ?
        `;

        parametros.push(filtros.maestro);
    }

    if (filtros.fechaInicio) {
        sql += `
            AND DATE(p.fecha_prestamo) >= ?
        `;

        parametros.push(filtros.fechaInicio);
    }

    if (filtros.fechaFin) {
        sql += `
            AND DATE(p.fecha_prestamo) <= ?
        `;

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

    const anio = fecha.getFullYear();

    const hora =
        String(fecha.getHours()).padStart(2, "0");

    const minuto =
        String(fecha.getMinutes()).padStartpadStart(2, "0");

    return `${dia}/${mes}/${anio} ${hora}:${minuto}`;
}

// =====================================================
// REPORTE FILTRADO JSON
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
// REPORTE PDF
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
// REPORTE EXCEL
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

                libro.creator = "Inventario Escolar";
                libro.created = new Date();

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
                        id: prestamo.id,
                        material_id: prestamo.material_id,
                        material: prestamo.material,
                        maestro: prestamo.maestro,

                        fecha_prestamo:
                            mostrarFechaReporte(
                                prestamo.fecha_prestamo
                            ),

                        fecha_devolucion:
                            mostrarFechaReporte(
                                prestamo.fecha_devolucion
                            ),

                        estado: prestamo.estado
                    });
                });

                const encabezado = hoja.getRow(1);

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
// ESTADÍSTICAS
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
            total: Number(result[0].total)
        });
    });
});

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
            pendientes: Number(result[0].pendientes)
        });
    });
});

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
            devueltos: Number(result[0].devueltos)
        });
    });
});

// =====================================================
// DASHBOARD
// =====================================================

app.get("/dashboard", (req, res) => {
    const sql = `
        SELECT
            (
                SELECT COUNT(*)
                FROM materiales
            ) AS total_materiales,

            (
                SELECT COUNT(*)
                FROM prestamos
                WHERE fecha_devolucion IS NULL
            ) AS prestados,

            (
                SELECT COUNT(*)
                FROM prestamos
                WHERE fecha_devolucion IS NOT NULL
            ) AS devueltos,

            (
                SELECT COUNT(*)
                FROM materiales
                WHERE LOWER(TRIM(estado)) = 'dañado'
            ) AS danados
    `;

    conexion.query(sql, (err, result) => {
        if (err) {
            console.error(
                "Error obteniendo métricas del dashboard:",
                err
            );

            return res.status(500).json({
                status: "error",
                mensaje:
                    "Error al obtener las métricas del dashboard"
            });
        }

        return res.status(200).json({
            total_materiales:
                Number(result[0].total_materiales),

            prestados:
                Number(result[0].prestados),

            devueltos:
                Number(result[0].devueltos),

            danados:
                Number(result[0].danados)
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
