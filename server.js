const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();

app.use(bodyParser.json());
app.use(cors());

// =====================================================
// CONEXIÓN A MYSQL
// =====================================================

const conexion = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "mySQL123",
  database: "restaurante_db",
});

conexion.connect((err) => {
  if (err) {
    console.error("Error al conectar a MySQL:", err);
    return;
  }

  console.log("Conectado a MySQL");
});

// =====================================================
// CONFIGURACIÓN DE MULTER
// =====================================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

// =====================================================
// SERVIR IMÁGENES
// =====================================================

app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// =====================================================
// RUTA PRINCIPAL
// =====================================================

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    mensaje: "Bienvenido a Restaurante API",
  });
});

// =====================================================
// LOGIN CON ROLES
// =====================================================

app.post("/login", (req, res) => {
  const { usuario, clave } = req.body;

  if (!usuario || !clave) {
    return res.status(400).json({
      status: "fail",
      mensaje: "Usuario y clave son obligatorios",
    });
  }

  const sql = `
    SELECT id, usuario, rol
    FROM usuarios
    WHERE usuario = ? AND clave = ?
    LIMIT 1
  `;

  conexion.query(sql, [usuario, clave], (err, result) => {
    if (err) {
      console.error("Error en login:", err);

      return res.status(500).json({
        status: "error",
        mensaje: "Error interno del servidor",
      });
    }

    if (result.length === 0) {
      return res.status(401).json({
        status: "fail",
        mensaje: "Credenciales incorrectas",
      });
    }

    const usuarioEncontrado = result[0];

    res.json({
      status: "ok",
      id: usuarioEncontrado.id,
      usuario: usuarioEncontrado.usuario,
      rol: usuarioEncontrado.rol,
      mensaje: "Acceso permitido",
    });
  });
});

// =====================================================
// USUARIOS
// =====================================================

// Obtener meseros
app.get("/usuarios/meseros", (req, res) => {
  const sql = `
    SELECT id, usuario, rol
    FROM usuarios
    WHERE rol = 'Mesero'
    ORDER BY usuario
  `;

  conexion.query(sql, (err, results) => {
    if (err) {
      console.error(err);

      return res.status(500).json({
        status: "error",
        mensaje: "Error al obtener meseros",
      });
    }

    res.json(results);
  });
});

// Obtener clientes
app.get("/usuarios/clientes", (req, res) => {
  const sql = `
    SELECT id, usuario, rol
    FROM usuarios
    WHERE rol = 'Cliente'
    ORDER BY usuario
  `;

  conexion.query(sql, (err, results) => {
    if (err) {
      console.error(err);

      return res.status(500).json({
        status: "error",
        mensaje: "Error al obtener clientes",
      });
    }

    res.json(results);
  });
});

// =====================================================
// REGISTRO DE USUARIOS (Mesero / Cliente)
// =====================================================

app.post("/registro", (req, res) => {
  const { usuario, clave, rol } = req.body;

  if (!usuario || !clave || !rol) {
    return res.status(400).json({
      status: "error",
      mensaje: "Usuario, clave y rol son obligatorios",
    });
  }

  if (usuario.trim().length < 3) {
    return res.status(400).json({
      status: "error",
      mensaje: "El usuario debe tener al menos 3 caracteres",
    });
  }

  if (clave.length < 4) {
    return res.status(400).json({
      status: "error",
      mensaje: "La clave debe tener al menos 4 caracteres",
    });
  }

  // Por seguridad, el registro público solo puede crear
  // Meseros o Clientes. El rol Administrador no se expone aquí.
  const rolesPermitidos = ["Mesero", "Cliente"];

  if (!rolesPermitidos.includes(rol)) {
    return res.status(400).json({
      status: "error",
      mensaje: "Rol inválido. Solo se permite Mesero o Cliente",
    });
  }

  const sqlExiste = `
    SELECT id
    FROM usuarios
    WHERE usuario = ?
    LIMIT 1
  `;

  conexion.query(sqlExiste, [usuario], (errExiste, existeResult) => {
    if (errExiste) {
      console.error(errExiste);

      return res.status(500).json({
        status: "error",
        mensaje: "Error al verificar el usuario",
      });
    }

    if (existeResult.length > 0) {
      return res.status(409).json({
        status: "error",
        mensaje: "Ese nombre de usuario ya está en uso",
      });
    }

    const sqlInsertar = `
      INSERT INTO usuarios
      (usuario, clave, rol)
      VALUES (?, ?, ?)
    `;

    conexion.query(sqlInsertar, [usuario, clave, rol], (err, result) => {
      if (err) {
        console.error(err);

        return res.status(500).json({
          status: "error",
          mensaje: "Error al registrar el usuario",
        });
      }

      res.json({
        status: "ok",
        mensaje: "Usuario registrado correctamente",
        id: result.insertId,
        usuario: usuario,
        rol: rol,
      });
    });
  });
});

// =====================================================
// PLATILLOS
// =====================================================

// GET: Obtener todos los platillos
app.get("/platillos", (req, res) => {
  const sql = `
    SELECT *
    FROM platillos
    ORDER BY id DESC
  `;

  conexion.query(sql, (err, results) => {
    if (err) {
      console.error(err);

      return res.status(500).json({
        status: "error",
        mensaje: "Error al obtener platillos",
      });
    }

    res.json(results);
  });
});

// =====================================================
// POST: REGISTRAR PLATILLO
// =====================================================

app.post("/platillos", upload.single("imagen"), (req, res) => {
  const { nombre, precio, categoria } = req.body;

  if (!nombre || !precio || !categoria) {
    return res.status(400).json({
      status: "error",
      mensaje: "Nombre, precio y categoría son obligatorios",
    });
  }

  const imagen = req.file ? req.file.filename : null;

  const sql = `
    INSERT INTO platillos
    (nombre, precio, imagen, categoria)
    VALUES (?, ?, ?, ?)
  `;

  conexion.query(
    sql,
    [nombre, precio, imagen, categoria],
    (err, result) => {
      if (err) {
        console.error(err);

        return res.status(500).json({
          status: "error",
          mensaje: "Error al registrar platillo",
        });
      }

      res.json({
        status: "ok",
        mensaje: "Platillo registrado correctamente",
        id: result.insertId,
        imagen: imagen,
      });
    }
  );
});

// =====================================================
// PUT: ACTUALIZAR PLATILLO
// =====================================================

app.put("/platillos/:id", upload.single("imagen"), (req, res) => {
  const id = req.params.id;
  const { nombre, precio, categoria } = req.body;

  if (!nombre || !precio || !categoria) {
    return res.status(400).json({
      status: "error",
      mensaje: "Nombre, precio y categoría son obligatorios",
    });
  }

  if (req.file) {
    const imagen = req.file.filename;

    const sql = `
      UPDATE platillos
      SET nombre = ?,
          precio = ?,
          categoria = ?,
          imagen = ?
      WHERE id = ?
    `;

    conexion.query(
      sql,
      [nombre, precio, categoria, imagen, id],
      (err, result) => {
        if (err) {
          console.error(err);

          return res.status(500).json({
            status: "error",
            mensaje: "Error al actualizar platillo",
          });
        }

        res.json({
          status: "ok",
          mensaje: "Platillo actualizado",
        });
      }
    );
  } else {
    const sql = `
      UPDATE platillos
      SET nombre = ?,
          precio = ?,
          categoria = ?
      WHERE id = ?
    `;

    conexion.query(
      sql,
      [nombre, precio, categoria, id],
      (err, result) => {
        if (err) {
          console.error(err);

          return res.status(500).json({
            status: "error",
            mensaje: "Error al actualizar platillo",
          });
        }

        res.json({
          status: "ok",
          mensaje: "Platillo actualizado",
        });
      }
    );
  }
});

// =====================================================
// DELETE: ELIMINAR PLATILLO
// =====================================================

app.delete("/platillos/:id", (req, res) => {
  const id = req.params.id;

  const sql = `
    DELETE FROM platillos
    WHERE id = ?
  `;

  conexion.query(sql, [id], (err, result) => {
    if (err) {
      console.error(err);

      return res.status(500).json({
        status: "error",
        mensaje: "Error al eliminar platillo",
      });
    }

    res.json({
      status: "ok",
      mensaje: "Platillo eliminado",
    });
  });
});

// =====================================================
// OPERACIONES
// =====================================================

// GET: Obtener operaciones
app.get("/operaciones", (req, res) => {
  const sql = `
    SELECT
      o.id,
      o.cantidad,
      o.precio,
      o.total,
      p.nombre
    FROM operaciones o
    JOIN platillos p
      ON o.platillo_id = p.id
    ORDER BY o.id DESC
  `;

  conexion.query(sql, (err, results) => {
    if (err) {
      return res.status(500).json({
        status: "error",
        mensaje: "Error al obtener operaciones",
      });
    }

    res.json(results);
  });
});

// POST: Registrar operación
app.post("/operaciones", (req, res) => {
  const {
    platillo_id,
    cantidad,
    precio,
    total,
  } = req.body;

  if (!platillo_id || !cantidad || precio == null || total == null) {
    return res.status(400).json({
      status: "error",
      mensaje: "Faltan datos de la operación",
    });
  }

  const sql = `
    INSERT INTO operaciones
    (platillo_id, cantidad, precio, total)
    VALUES (?, ?, ?, ?)
  `;

  conexion.query(
    sql,
    [platillo_id, cantidad, precio, total],
    (err, result) => {
      if (err) {
        console.error(err);

        return res.status(500).json({
          status: "error",
          mensaje: "Error al registrar operación",
        });
      }

      res.json({
        status: "ok",
        mensaje: "Operación registrada",
      });
    }
  );
});

// =====================================================
// REPORTES GENERALES
// =====================================================

// Total de ventas
app.get("/reportes/total", (req, res) => {
  const sql = `
    SELECT SUM(total) AS total_ventas
    FROM operaciones
  `;

  conexion.query(sql, (err, result) => {
    if (err) {
      return res.status(500).json({
        status: "error",
        mensaje: "Error al obtener total",
      });
    }

    res.json(result[0]);
  });
});

// Promedio de precios
app.get("/reportes/promedio", (req, res) => {
  const sql = `
    SELECT AVG(precio) AS promedio_precio
    FROM operaciones
  `;

  conexion.query(sql, (err, result) => {
    if (err) {
      return res.status(500).json({
        status: "error",
        mensaje: "Error al obtener promedio",
      });
    }

    res.json(result[0]);
  });
});

// Platillo más vendido
app.get("/reportes/masvendido", (req, res) => {
  const sql = `
    SELECT
      p.nombre,
      SUM(o.cantidad) AS cantidad_vendida
    FROM operaciones o
    JOIN platillos p
      ON o.platillo_id = p.id
    GROUP BY p.nombre
    ORDER BY cantidad_vendida DESC
    LIMIT 1
  `;

  conexion.query(sql, (err, result) => {
    if (err) {
      return res.status(500).json({
        status: "error",
        mensaje: "Error al obtener platillo más vendido",
      });
    }

    res.json(
      result.length > 0
        ? result[0]
        : {
            nombre: "Sin datos",
            cantidad_vendida: 0,
          }
    );
  });
});

// =====================================================
// ORDENES
// Nota: se unificó en un solo endpoint (antes existían dos
// app.post("/ordenes", ...) duplicados; Express solo ejecutaba
// el primero, así que el segundo bloque quedaba muerto).
// Este endpoint crea la orden, su detalle, y devuelve un
// bloque "notificacion" que Flutter usa para disparar el
// aviso local con flutter_local_notifications.
// =====================================================

app.post("/ordenes", (req, res) => {
  const { total, detalle, usuario_id } = req.body;

  if (!usuario_id) {
    return res.status(400).json({
      status: "error",
      mensaje: "Debe indicar el usuario que registra la orden",
    });
  }

  if (!Array.isArray(detalle) || detalle.length === 0) {
    return res.status(400).json({
      status: "error",
      mensaje: "El carrito está vacío",
    });
  }

  const sqlUsuario = `
    SELECT id, rol
    FROM usuarios
    WHERE id = ?
    LIMIT 1
  `;

  conexion.query(sqlUsuario, [usuario_id], (errUsuario, usuarioResult) => {
    if (errUsuario) {
      console.error(errUsuario);

      return res.status(500).json({
        status: "error",
        mensaje: "Error al verificar usuario",
      });
    }

    if (usuarioResult.length === 0) {
      return res.status(404).json({
        status: "error",
        mensaje: "Usuario no encontrado",
      });
    }

    const sqlOrden = `
      INSERT INTO ordenes
      (total, usuario_id)
      VALUES (?, ?)
    `;

    conexion.query(sqlOrden, [total, usuario_id], (err, result) => {
      if (err) {
        console.error(err);

        return res.status(500).json({
          status: "error",
          mensaje: "Error al crear la orden",
        });
      }

      const ordenId = result.insertId;

      const sqlDetalle = `
        INSERT INTO detalle_orden
        (orden_id, platillo_id, cantidad, subtotal)
        VALUES (?, ?, ?, ?)
      `;

      let pendientes = detalle.length;
      let huboError = false;

      detalle.forEach((d) => {
        conexion.query(
          sqlDetalle,
          [ordenId, d.platillo_id, d.cantidad, d.subtotal],
          (errDetalle) => {
            pendientes--;

            if (errDetalle) {
              huboError = true;
              console.error(errDetalle);
            }

            if (pendientes === 0) {
              if (huboError) {
                return res.json({
                  status: "error",
                  mensaje:
                    "La orden se creó pero hubo un error en el detalle",
                  ordenId: ordenId,
                });
              }

              // Evento que dispara la notificación en el cliente
              console.log(
                `🔔 EVENTO: Nueva orden #${ordenId} registrada por un total de $${total}`
              );

              res.json({
                status: "ok",
                mensaje: "Orden registrada",
                ordenId: ordenId,
                notificacion: {
                  titulo: "¡Nueva Orden Registrada!",
                  cuerpo: `La orden #${ordenId} fue registrada por un total de $${total}.`,
                },
              });
            }
          }
        );
      });
    });
  });
});

// =====================================================
// GUÍA 17
// REPORTES POR MESERO
// =====================================================

app.get("/reportes/mesero/:id", (req, res) => {
  const id = req.params.id;

  const sql = `
    SELECT
      o.id,
      o.fecha,
      o.total,
      u.id AS usuario_id,
      u.usuario,
      u.rol
    FROM ordenes o
    JOIN usuarios u
      ON o.usuario_id = u.id
    WHERE u.id = ?
      AND u.rol = 'Mesero'
    ORDER BY o.fecha DESC
  `;

  conexion.query(sql, [id], (err, results) => {
    if (err) {
      console.error(err);

      return res.status(500).json({
        status: "error",
        mensaje: "Error al obtener reporte del mesero",
      });
    }

    res.json(results);
  });
});

// =====================================================
// GUÍA 17
// REPORTES POR CLIENTE
// =====================================================

app.get("/reportes/cliente/:id", (req, res) => {
  const id = req.params.id;

  const sql = `
    SELECT
      o.id,
      o.fecha,
      o.total,
      u.id AS usuario_id,
      u.usuario,
      u.rol
    FROM ordenes o
    JOIN usuarios u
      ON o.usuario_id = u.id
    WHERE u.id = ?
      AND u.rol = 'Cliente'
    ORDER BY o.fecha DESC
  `;

  conexion.query(sql, [id], (err, results) => {
    if (err) {
      console.error(err);

      return res.status(500).json({
        status: "error",
        mensaje: "Error al obtener reporte del cliente",
      });
    }

    res.json(results);
  });
});

// =====================================================
// HISTORIAL DE ORDENES
// =====================================================

app.get("/historial", (req, res) => {
  const sql = `
    SELECT
      o.id,
      o.fecha,
      o.total,
      u.usuario,
      u.rol,
      p.nombre,
      d.cantidad,
      d.subtotal
    FROM ordenes o
    JOIN usuarios u
      ON o.usuario_id = u.id
    JOIN detalle_orden d
      ON o.id = d.orden_id
    JOIN platillos p
      ON d.platillo_id = p.id
    ORDER BY o.fecha DESC
  `;

  conexion.query(sql, (err, results) => {
    if (err) {
      console.error(err);

      return res.status(500).json({
        status: "error",
        mensaje: "Error al obtener historial",
      });
    }

    res.json(results);
  });
});

// =====================================================
// ESTADÍSTICAS
// =====================================================

// Ventas por mesero
app.get("/estadisticas/meseros", (req, res) => {
  const sql = `
    SELECT u.usuario, SUM(o.total) AS ventas
    FROM ordenes o
    JOIN usuarios u ON o.usuario_id = u.id
    WHERE u.rol = 'Mesero'
    GROUP BY u.usuario
  `;

  conexion.query(sql, (err, results) => {
    if (err) {
      console.error("Error al obtener estadísticas de meseros:", err);

      return res.status(500).json({
        status: "error",
        mensaje: "Error interno al obtener las estadísticas",
      });
    }

    res.json(results);
  });
});

// Pedidos por cliente
app.get("/estadisticas/clientes", (req, res) => {
  const sql = `
    SELECT u.usuario, COUNT(o.id) AS pedidos
    FROM ordenes o
    JOIN usuarios u ON o.usuario_id = u.id
    WHERE u.rol = 'Cliente'
    GROUP BY u.usuario
  `;

  conexion.query(sql, (err, results) => {
    if (err) {
      console.error("Error al obtener estadísticas de clientes:", err);

      return res.status(500).json({
        status: "error",
        mensaje: "Error interno al obtener las estadísticas",
      });
    }

    res.json(results);
  });
});

// =====================================================
// EXPORTACIÓN DE REPORTES (PDF Y EXCEL)
// =====================================================

// Exportar a PDF
app.get("/export/pdf", (req, res) => {
  const doc = new PDFDocument();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="reportes.pdf"');

  doc.pipe(res);
  doc.fontSize(20).text("Reporte de Ventas", { align: "center" });
  doc.moveDown();

  const sql = "SELECT * FROM ordenes";
  conexion.query(sql, (err, results) => {
    if (err) {
      console.error("Error al consultar DB para PDF:", err);
      doc.fontSize(12).text("Error interno al generar el reporte.");
      doc.end();
    } else {
      results.forEach(r => {
        doc.fontSize(12).text(`Orden #${r.id} | Fecha: ${r.fecha} | Total: $${r.total}`);
        doc.moveDown(0.5);
      });
      doc.end();
    }
  });
});

// Exportar a Excel con exceljs
app.get("/export/excel", async (req, res) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Reporte Ventas");

  sheet.columns = [
    { header: "ID Orden", key: "id", width: 15 },
    { header: "Fecha", key: "fecha", width: 30 },
    { header: "Total", key: "total", width: 15 }
  ];

  conexion.query("SELECT * FROM ordenes", async (err, results) => {
    if (err) {
      console.error("Error al consultar DB para Excel:", err);
      return res.status(500).json({ status: "error", mensaje: "Error al generar Excel" });
    } else {
      results.forEach(r => {
        sheet.addRow({ id: r.id, fecha: r.fecha, total: r.total });
      });

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="reportes.xlsx"');

      try {
        await workbook.xlsx.write(res);
        res.end();
      } catch (writeErr) {
        console.error("Error al escribir el archivo Excel:", writeErr);
        res.status(500).end();
      }
    }
  });
});

// =====================================================
// INICIAR SERVIDOR
// =====================================================

app.listen(3000, "0.0.0.0", () => {
  console.log("--------------------------------------");
  console.log(" RESTAURANTE API");
  console.log("--------------------------------------");
  console.log("Servidor iniciado en puerto 3000");
  console.log("API: http://localhost:3000");
  console.log("--------------------------------------");
});