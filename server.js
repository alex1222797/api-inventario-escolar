// =====================================================
// REGISTRAR PRÉSTAMO
// =====================================================
//
// Este endpoint registra un préstamo de material.
//
// Flutter enviará:
// material_id
// fecha_prestamo
// fecha_devolucion
// maestro
//

app.post("/prestamos", (req, res) => {

    // Extraemos los datos enviados por Flutter.
    const {
        material_id,
        fecha_prestamo,
        fecha_devolucion,
        maestro
    } = req.body;


    // Validamos los campos obligatorios.
    if (!material_id || !fecha_prestamo || !maestro) {
        return res.status(400).json({
            status: "error",
            mensaje: "Faltan datos obligatorios"
        });
    }


    // Consulta SQL parametrizada.
    const sql = `
        INSERT INTO prestamos
        (material_id, fecha_prestamo, fecha_devolucion, maestro)
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
                console.error("Error registrando préstamo:", err);

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
