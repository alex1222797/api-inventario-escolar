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
// CONSULTA PARA REPORTES FILTRADOS
// =====================================================

function obtenerFiltrosReporte(req) {
    return {
        maestro: req.query.maestro?.toString().trim() || "",
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

    sql += " ORDER BY p.fecha_prestamo DESC, p.id DESC";

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

    const dia = fecha
        .getDate()
        .toString()
        .padStart(2, "0");

    const mes = (fecha.getMonth() + 1)
        .toString()
        .padStart(2, "0");

    const anio = fecha.getFullYear();

    const hora = fecha
        .getHours()
        .toString()
        .padStart(2, "0");

    const minuto = fecha
        .getMinutes()
        .toString()
        .padStart(2, "0");

    return `${dia}/${mes}/${anio} ${hora}:${minuto}`;
}

// =====================================================
// REPORTE FILTRADO EN JSON
// =====================================================

app.get("/reportes/filtrados", (req, res) => {
    const filtros = obtenerFiltrosReporte(req);
    const errorFiltros = validarFiltrosReporte(filtros);

    if (errorFiltros) {
        return res.status(400).json({
            status: "fail",
            mensaje: errorFiltros
        });
    }

    const consulta = construirConsultaReporte(filtros);

    conexion.query(
        consulta.sql,
        consulta.parametros,
        (err, result) => {
            if (err) {
                console.error(
                    "Error obteniendo reporte filtrado:",
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
    const errorFiltros = validarFiltrosReporte(filtros);

    if (errorFiltros) {
        return res.status(400).json({
            status: "fail",
            mensaje: errorFiltros
        });
    }

    const consulta = construirConsultaReporte(filtros);

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
                    mensaje: "Error al generar el reporte PDF"
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

            const documento = new PDFDocument({
                size: "A4",
                margin: 45,
                info: {
                    Title: "Reporte de préstamos",
                    Author: "Inventario Escolar"
                }
            });

            documento.pipe(res);

            documento
                .font("Helvetica-Bold")
                .fontSize(20)
                .fillColor("#0F7A8C")
                .text(
                    "Inventario Escolar",
                    { align: "center" }
                );

            documento
                .fontSize(16)
                .text(
                    "Reporte filtrado de préstamos",
                    { align: "center" }
                );

            documento.moveDown();

            documento
                .font("Helvetica")
                .fontSize(10)
                .fillColor("#222222")
                .text(
                    `Maestro: ${
                        filtros.maestro || "Todos"
                    }`
                )
                .text(
                    `Fecha inicial: ${
                        filtros.fechaInicio || "Sin filtro"
                    }`
                )
                .text(
                    `Fecha final: ${
                        filtros.fechaFin || "Sin filtro"
                    }`
                )
                .text(
                    `Total de registros: ${prestamos.length}`
                );

            documento.moveDown();

            if (prestamos.length === 0) {
                documento
                    .fontSize(12)
                    .text(
                        "No se encontraron préstamos con estos filtros."
                    );
            }

            prestamos.forEach((prestamo, index) => {
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
                    .fillColor("#222222")
                    .text(
                        `Préstamo ID: ${prestamo.id}`
                    )
                    .text(
                        `Material ID: ${prestamo.material_id}`
                    )
                    .text(
                        `Maestro: ${prestamo.maestro}`
                    )
                    .text(
                        `Fecha préstamo: ${
                            mostrarFechaReporte(
                                prestamo.fecha_prestamo
                            )
                        }`
                    )
                    .text(
                        `Fecha devolución: ${
                            mostrarFechaReporte(
                                prestamo.fecha_devolucion
                            )
                        }`
                    )
                    .text(
                        `Estado: ${prestamo.estado}`
                    );

                documento.moveDown();
                documento
                    .strokeColor("#7FDBDA")
                    .moveTo(45, documento.y)
                    .lineTo(550, documento.y)
                    .stroke();

                documento.moveDown();
            });

            documento.end();
        }
    );
});

// =====================================================
// EXPORTAR REPORTE A EXCEL
// =====================================================

app.get("/reportes/excel", (req, res) => {
    const filtros = obtenerFiltrosReporte(req);
    const errorFiltros = validarFiltrosReporte(filtros);

    if (errorFiltros) {
        return res.status(400).json({
            status: "fail",
            mensaje: errorFiltros
        });
    }

    const consulta = construirConsultaReporte(filtros);

    conexion.query(
        consulta.sql,
        consulta.parametros,
        async (err, prestamos) => {
            if (err) {
                console.error(
                    "Error generando reporte Excel:",
                    err
                );

                return res.status(500).json({
                    status: "error",
                    mensaje:
                        "Error al generar el reporte Excel"
                });
            }

            try {
                const libro = new ExcelJS.Workbook();

                libro.creator = "Inventario Escolar";
                libro.created = new Date();

                const hojaFiltros =
                    libro.addWorksheet("Filtros");

                hojaFiltros.addRows([
                    ["REPORTE FILTRADO DE PRÉSTAMOS"],
                    [
                        "Maestro",
                        filtros.maestro || "Todos"
                    ],
                    [
                        "Fecha inicial",
                        filtros.fechaInicio || "Sin filtro"
                    ],
                    [
                        "Fecha final",
                        filtros.fechaFin || "Sin filtro"
                    ],
                    [
                        "Total",
                        prestamos.length
                    ]
                ]);

                hojaFiltros.getCell("A1").font = {
                    bold: true,
                    size: 16,
                    color: {
                        argb: "FF0F7A8C"
                    }
                };

                hojaFiltros.getColumn(1).width = 24;
                hojaFiltros.getColumn(2).width = 30;

                const hoja =
                    libro.addWorksheet("Préstamos", {
                        views: [
                            {
                                state: "frozen",
                                ySplit: 1
                            }
                        ]
                    });

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

                encabezado.height = 24;

                hoja.autoFilter = {
                    from: "A1",
                    to: "G1"
                };

                hoja.eachRow((fila, numeroFila) => {
                    fila.alignment = {
                        vertical: "middle"
                    };

                    if (
                        numeroFila > 1 &&
                        numeroFila % 2 === 0
                    ) {
                        fila.fill = {
                            type: "pattern",
                            pattern: "solid",
                            fgColor: {
                                argb: "FFF3FCFB"
                            }
                        };
                    }
                });

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
                    "Error creando archivo Excel:",
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
