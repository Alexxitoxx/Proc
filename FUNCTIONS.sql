-- =========================
-- FUNCIONES Y TRIGGERS
-- =========================
CREATE OR REPLACE FUNCTION obtener_precio_vigente(p_id_producto INT, p_id_servicio INT) 
RETURNS DECIMAL AS $$
DECLARE
    v_precio_base DECIMAL;
    v_porcentaje DECIMAL;
    v_id_desc INT;
BEGIN
    IF p_id_producto IS NOT NULL THEN
        SELECT precio, id_descuento INTO v_precio_base, v_id_desc FROM productos WHERE id = p_id_producto;
    ELSE
        SELECT precio_base, id_descuento INTO v_precio_base, v_id_desc FROM servicios WHERE id = p_id_servicio;
    END IF;

    -- Buscar si el descuento es válido (Sin cupón y en fecha)
    SELECT porcentaje_descuento INTO v_porcentaje
    FROM descuentos 
    WHERE id = v_id_desc 
      AND codigo_cupon IS NULL -- Solo descuentos automáticos
      AND CURRENT_TIMESTAMP BETWEEN fecha_inicio AND fecha_fin;

    IF v_porcentaje IS NOT NULL THEN
        RETURN v_precio_base * (1 - (v_porcentaje / 100));
    END IF;

    RETURN v_precio_base;
END;
$$ LANGUAGE plpgsql;





CREATE OR REPLACE FUNCTION trg_actualizar_calificacion() 
RETURNS TRIGGER AS $$
BEGIN
    -- Actualizar producto si la reseña es de un producto
    IF COALESCE(NEW.id_producto, OLD.id_producto) IS NOT NULL THEN
        UPDATE productos
        SET calificacion = (
            SELECT ROUND(AVG(calificacion)::numeric, 1)
            FROM resenas 
            WHERE id_producto = COALESCE(NEW.id_producto, OLD.id_producto)
        )
        WHERE id = COALESCE(NEW.id_producto, OLD.id_producto);
    END IF;

    -- Actualizar servicio si la reseña es de un servicio
    IF COALESCE(NEW.id_servicio, OLD.id_servicio) IS NOT NULL THEN
        UPDATE servicios
        SET calificacion = (
            SELECT ROUND(AVG(calificacion)::numeric, 1)
            FROM resenas 
            WHERE id_servicio = COALESCE(NEW.id_servicio, OLD.id_servicio)
        )
        WHERE id = COALESCE(NEW.id_servicio, OLD.id_servicio);
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_actualizar_calificacion ON resenas;
CREATE TRIGGER tg_actualizar_calificacion
AFTER INSERT OR UPDATE OR DELETE ON resenas
FOR EACH ROW EXECUTE FUNCTION trg_actualizar_calificacion();





-- La función del trigger
CREATE OR REPLACE FUNCTION trg_llenar_snapshot_detalle() 
RETURNS TRIGGER AS $$
DECLARE
    v_nombre VARCHAR;
    v_imagen TEXT;
    v_precio_base DECIMAL;
BEGIN
    -- Solo calculamos el precio si viene en 0 o NULL (para no pisar cupones manuales de la función)
    IF NEW.precio_unitario_historico IS NULL OR NEW.precio_unitario_historico = 0 THEN
        NEW.precio_unitario_historico := obtener_precio_vigente(NEW.id_producto, NEW.id_servicio);
    END IF;

    IF NEW.id_producto IS NOT NULL THEN
        SELECT p.nombre, p.precio, pi.url_imagen INTO v_nombre, v_precio_base, v_imagen
        FROM productos p
        LEFT JOIN producto_imagenes pi ON p.id = pi.id_producto AND pi.es_principal = TRUE
        WHERE p.id = NEW.id_producto;
    ELSE
        SELECT s.nombre, s.precio_base, si.url_imagen INTO v_nombre, v_precio_base, v_imagen
        FROM servicios s
        LEFT JOIN servicio_imagenes si ON s.id = si.id_servicio AND si.es_principal = TRUE
        WHERE s.id = NEW.id_servicio;
    END IF;

    NEW.snapshot_item := jsonb_build_object(
        'nombre', v_nombre, 
        'imagen_principal', v_imagen,
        'precio_original_sin_descuento', v_precio_base
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_snapshot_detalle ON detalle_pedido;
CREATE TRIGGER tg_snapshot_detalle
BEFORE INSERT ON detalle_pedido
FOR EACH ROW EXECUTE FUNCTION trg_llenar_snapshot_detalle();






CREATE OR REPLACE FUNCTION trg_sync_stock_producto() 
RETURNS TRIGGER AS $$
BEGIN
    UPDATE productos
    SET stock_total = (
        SELECT COALESCE(SUM(stock_disponible), 0)
        FROM lotes_inventario
        WHERE id_producto = COALESCE(NEW.id_producto, OLD.id_producto)
          AND fecha_caducidad >= CURRENT_DATE -- ESTO ES LO QUE FALTABA
    )
    WHERE id = COALESCE(NEW.id_producto, OLD.id_producto);
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_sync_stock ON lotes_inventario;
CREATE TRIGGER tg_sync_stock
AFTER INSERT OR UPDATE OR DELETE ON lotes_inventario
FOR EACH ROW EXECUTE FUNCTION trg_sync_stock_producto();


CREATE OR REPLACE FUNCTION procesar_checkout(
    p_id_usuario INT,
    p_direccion_snapshot JSONB,
    p_metodo_pago_snapshot JSONB
) RETURNS INT AS $$
DECLARE
    v_id_carrito INT;
    v_id_pedido INT;
    v_total DECIMAL(10,2) := 0;
    v_item RECORD;
    v_lote RECORD;
    v_cantidad_restante INT;
    v_precio_item DECIMAL(12,2);
BEGIN
    -- 1. Validar existencia del carrito
    SELECT id INTO v_id_carrito FROM carrito WHERE id_usuario = p_id_usuario;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'El usuario % no tiene un carrito activo.', p_id_usuario;
    END IF;

    -- 2. Crear el pedido inicial (total 0 por ahora, estado PENDIENTE)
    INSERT INTO pedidos (id_usuario, total, estado_pedido, direccion_envio_snapshot, metodo_pago_snapshot)
    VALUES (p_id_usuario, 0, 'PENDIENTE', p_direccion_snapshot, p_metodo_pago_snapshot)
    RETURNING id INTO v_id_pedido;

    -- 3. Iterar sobre cada item en el carrito
    FOR v_item IN (SELECT * FROM carrito_items WHERE id_carrito = v_id_carrito) LOOP
        
        -- RAMA A: Es un Producto
        IF v_item.id_producto IS NOT NULL THEN
            -- Bloqueamos el producto temporalmente para asegurar la lectura del precio
            v_precio_item := obtener_precio_vigente(v_item.id_producto, NULL);
            v_cantidad_restante := v_item.cantidad;
            
            -- Verificar si hay stock total válido (no caducado) ANTES de iterar
            IF (SELECT COALESCE(SUM(stock_disponible), 0) 
                FROM lotes_inventario 
                WHERE id_producto = v_item.id_producto 
                AND fecha_caducidad >= CURRENT_DATE) < v_cantidad_restante THEN
                RAISE EXCEPTION 'Stock insuficiente o caducado para el producto ID %', v_item.id_producto;
            END IF;

            -- Lógica FIFO: Descontar de los lotes más próximos a caducar
            FOR v_lote IN (
                SELECT id, stock_disponible 
                FROM lotes_inventario 
                WHERE id_producto = v_item.id_producto 
                  AND fecha_caducidad >= CURRENT_DATE 
                  AND stock_disponible > 0
                ORDER BY fecha_caducidad ASC
                FOR UPDATE -- ESTO ES CRÍTICO: Bloquea la fila del lote contra compras simultáneas
            ) LOOP
                IF v_cantidad_restante = 0 THEN
                    EXIT; -- Ya cubrimos la cantidad requerida
                END IF;

                IF v_lote.stock_disponible >= v_cantidad_restante THEN
                    UPDATE lotes_inventario 
                    SET stock_disponible = stock_disponible - v_cantidad_restante 
                    WHERE id = v_lote.id;
                    v_cantidad_restante := 0;
                ELSE
                    UPDATE lotes_inventario 
                    SET stock_disponible = 0 
                    WHERE id = v_lote.id;
                    v_cantidad_restante := v_cantidad_restante - v_lote.stock_disponible;
                END IF;
            END LOOP;

            -- Insertar el detalle. 
            -- (Nota: El trigger trg_llenar_snapshot_detalle que creamos antes interceptará esto 
            -- y le inyectará el JSON con el nombre y la foto al vuelo).
            INSERT INTO detalle_pedido (id_pedido, id_producto, cantidad, precio_unitario_historico)
            VALUES (v_id_pedido, v_item.id_producto, v_item.cantidad, v_precio_item);
            
            v_total := v_total + (v_precio_item * v_item.cantidad);

        -- RAMA B: Es un Servicio
        ELSIF v_item.id_servicio IS NOT NULL THEN
            v_precio_item := obtener_precio_vigente(NULL, v_item.id_servicio);
            
            INSERT INTO detalle_pedido (id_pedido, id_servicio, cantidad, precio_unitario_historico, id_agenda_seleccionada)
            VALUES (v_id_pedido, v_item.id_servicio, v_item.cantidad, v_precio_item, v_item.id_agenda_seleccionada);
            
            v_total := v_total + (v_precio_item * v_item.cantidad);
        END IF;
    END LOOP;

    -- Validar que el carrito no estuviera vacío
    IF v_total = 0 THEN
        RAISE EXCEPTION 'El carrito está vacío. No se puede generar un pedido.';
    END IF;

    -- 4. Actualizar el costo total real del pedido
    UPDATE pedidos SET total = v_total WHERE id = v_id_pedido;

    -- 5. Vaciar el carrito (Solo borramos los items, conservamos el ID del carrito para el usuario)
    DELETE FROM carrito_items WHERE id_carrito = v_id_carrito;

    -- Devolvemos el ID del pedido creado al backend
    RETURN v_id_pedido;
END;
$$ LANGUAGE plpgsql;





CREATE OR REPLACE FUNCTION purgar_lotes_caducados() 
RETURNS VOID AS $$
BEGIN
    -- Poner a 0 el stock de la mercancía caducada.
    -- Al hacer este UPDATE, PostgreSQL disparará automáticamente 
    -- el trigger trg_sync_stock_producto() para recalcular los totales.
    UPDATE lotes_inventario
    SET stock_disponible = 0
    WHERE fecha_caducidad < CURRENT_DATE 
      AND stock_disponible > 0;
END;
$$ LANGUAGE plpgsql;



