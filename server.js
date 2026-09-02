// =====================================================
// NOTIFICACIONES DE PRÉSTAMOS PENDIENTES POR MAESTRO
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
