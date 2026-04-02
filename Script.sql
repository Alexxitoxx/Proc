CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- =========================
-- TABLA ROLES
-- =========================
DROP TABLE IF EXISTS roles CASCADE;
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    nombre_rol VARCHAR(50) NOT NULL
);

-- =========================
-- TABLA USUARIOS
-- =========================
DROP TABLE IF EXISTS usuarios CASCADE;
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    id_rol INT NOT NULL,
    nombre VARCHAR(150) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    telefono VARCHAR(20),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activo BOOLEAN DEFAULT TRUE,
    fecha_eliminacion TIMESTAMP NULL,
    avatar_url TEXT NULL,
    FOREIGN KEY (id_rol) REFERENCES roles(id)
);
CREATE INDEX idx_usuarios_activos ON usuarios(email) WHERE activo = TRUE;

-- =========================
-- TABLA DIRECCIONES
-- =========================
DROP TABLE IF EXISTS direcciones CASCADE;
CREATE TABLE direcciones (
    id SERIAL PRIMARY KEY,
    calle VARCHAR(200) NOT NULL,
    ciudad VARCHAR(100) NOT NULL,
    estado VARCHAR(100) NOT NULL,
    codigo_postal VARCHAR(20) NOT NULL,
    pais VARCHAR(100) NOT NULL,
    geo_location GEOGRAPHY(POINT, 4326) NOT NULL
);

CREATE INDEX idx_direcciones_geo_location ON direcciones USING GIST (geo_location);

-- =========================
-- TABLA REL_usuario_direcciones
-- =========================
DROP TABLE IF EXISTS rel_usuario_direcciones CASCADE;
CREATE TABLE REL_usuario_direcciones (
    id_usuario INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    id_direccion INT NOT NULL REFERENCES direcciones(id) ON DELETE CASCADE,
    es_principal BOOLEAN DEFAULT FALSE,
    tipo_direccion VARCHAR(20) DEFAULT 'hogar',
    PRIMARY KEY (id_usuario, id_direccion)
);

-- =========================
-- METODOS DE PAGO
-- =========================
DROP TABLE IF EXISTS metodos_pago CASCADE;
CREATE TABLE metodos_pago (
    id SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL,
    proveedor_pago VARCHAR(100),
    token_pasarela TEXT,
    ultimos_cuatro VARCHAR(4),
    fecha_expiracion VARCHAR(5),
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id) ON DELETE CASCADE
);

-- =========================
-- TABLA NEGOCIOS
-- =========================
-- CORRECCIÓN: Se agregó id_direccion porque al quitar sucursales, el negocio debe tener una ubicación matriz obligatoria.
DROP TABLE IF EXISTS negocios CASCADE;
CREATE TABLE negocios (
    id SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL REFERENCES usuarios(id),
    nombre_comercial VARCHAR(150) NOT NULL,
    rfc_tax_id VARCHAR(50) UNIQUE,
    id_direccion INT NOT NULL REFERENCES direcciones(id), 
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    logo_url TEXT NULL
);

-- =========================
-- TABLA CATEGORIAS
-- =========================
DROP TABLE IF EXISTS categorias CASCADE;
CREATE TABLE categorias (
    id SERIAL PRIMARY KEY,
    nombre_categoria VARCHAR(120) NOT NULL,
    descripcion TEXT,
    icon_url TEXT NULL,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('producto', 'servicio', 'ambos')),
    UNIQUE (nombre_categoria, tipo) 
);

-- =========================
-- TABLA PRODUCTOS
-- =========================
-- CORRECCIÓN: Se agregó stock_total directo aquí y un booleano de activo para controlar visibilidad.
DROP TABLE IF EXISTS productos CASCADE;
CREATE TABLE productos (
    id SERIAL PRIMARY KEY,
    id_negocio INT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    calificacion DECIMAL(2,1),
    precio DECIMAL(12,2) NOT NULL CHECK (precio >= 0),
    stock_total INT NOT NULL DEFAULT 0 CHECK (stock_total >= 0), 
    sku VARCHAR(100) UNIQUE,
    esta_activo BOOLEAN DEFAULT TRUE,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    embedding_vector vector(1536) 
    -- NECESITA RELACION A TABLA IMAGENES
);

-- =========================
-- TABLA MANEJO DE LOTES
-- =========================
-- CORRECCIÓN: Apunta directo al producto en lugar de a la sucursal.
DROP TABLE IF EXISTS lotes_inventario CASCADE;
CREATE TABLE lotes_inventario (
    id SERIAL PRIMARY KEY,
    id_producto INT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    stock_disponible INT NOT NULL DEFAULT 0 CHECK (stock_disponible >= 0),
    fecha_recibido DATE DEFAULT CURRENT_DATE,
    fecha_caducidad DATE NOT NULL
);

-- =========================
-- RELACION PRODUCTO-CATEGORIA
-- =========================
DROP TABLE IF EXISTS producto_categoria CASCADE;
CREATE TABLE producto_categoria (
    id_producto INT NOT NULL,
    id_categoria INT NOT NULL,
    PRIMARY KEY (id_producto, id_categoria),
    FOREIGN KEY (id_producto) REFERENCES productos(id) ON DELETE CASCADE,
    FOREIGN KEY (id_categoria) REFERENCES categorias(id) ON DELETE CASCADE
);

-- =========================
-- TABLA SERVICIOS
-- =========================
-- CORRECCIÓN: Se agregó esta_activo para suplir la tabla de relación eliminada.
DROP TABLE IF EXISTS servicios CASCADE;
CREATE TABLE servicios (
    id SERIAL PRIMARY KEY,
    id_negocio INT NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT,
    precio_base DECIMAL(10,2) NOT NULL,
    duracion_minutos INT,
    calificacion DECIMAL (2,1),
    esta_activo BOOLEAN DEFAULT TRUE,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_negocio) REFERENCES negocios(id) ON DELETE CASCADE
);

-- =========================
-- TABLA AGENDA SERVICIOS
-- =========================
-- CORRECCIÓN: Se eliminó id_sucursal.
DROP TABLE IF EXISTS agenda_servicios CASCADE;
CREATE TABLE agenda_servicios (
    id SERIAL PRIMARY KEY,
    id_servicio INT NOT NULL,
    fecha_hora_inicio TIMESTAMP,
    fecha_hora_fin TIMESTAMP,
    estado VARCHAR(50) DEFAULT 'disponible',
    id_usuario_cliente INT,
    FOREIGN KEY (id_servicio) REFERENCES servicios(id),
    FOREIGN KEY (id_usuario_cliente) REFERENCES usuarios(id)
    -- NECESITA RELACION A TABLA IMAGENES
);

-- =========================
-- TABLA CARRITO (AÚN INEFICIENTE)
-- =========================
DROP TABLE IF EXISTS carrito CASCADE;
CREATE TABLE carrito (
    id SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL UNIQUE,
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id)
);

-- =========================
-- TABLA CARRITO ITEMS
-- =========================
DROP TABLE IF EXISTS carrito_items CASCADE;
CREATE TABLE carrito_items (
    id SERIAL PRIMARY KEY, 
    id_carrito INT NOT NULL REFERENCES carrito(id) ON DELETE CASCADE,
    id_producto INT REFERENCES productos(id),
    id_servicio INT REFERENCES servicios(id),
    id_agenda_seleccionada INT REFERENCES agenda_servicios(id),
    cantidad INT NOT NULL CHECK (cantidad > 0),
    CONSTRAINT check_item_type CHECK (
        (id_producto IS NOT NULL AND id_servicio IS NULL) OR 
        (id_producto IS NULL AND id_servicio IS NOT NULL)
    )
);

-- =========================
-- TABLA PEDIDOS
-- =========================
DROP TABLE IF EXISTS pedidos CASCADE;
CREATE TABLE pedidos (
    id SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    estado_pedido VARCHAR(50) DEFAULT 'PENDIENTE',
    direccion_envio_snapshot JSONB NOT NULL,
    metodo_pago_snapshot JSONB NOT NULL,
    fecha_pedido TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id)
);

-- =========================
-- DETALLE PEDIDO
-- =========================
-- CORRECCIÓN: Se eliminó id_sucursal.
DROP TABLE IF EXISTS detalle_pedido CASCADE;
CREATE TABLE detalle_pedido (
    id SERIAL PRIMARY KEY,
    id_pedido INT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    id_producto INT REFERENCES productos(id),
    snapshot_item JSONB NOT NULL,
    id_servicio INT REFERENCES servicios(id),
    cantidad INT NOT NULL CHECK (cantidad > 0),
    precio_unitario_historico DECIMAL(12,2) NOT NULL,
    id_agenda_seleccionada INT REFERENCES agenda_servicios(id) ON DELETE SET NULL,
    CONSTRAINT check_detalle_type CHECK (
        (id_producto IS NOT NULL AND id_servicio IS NULL) OR 
        (id_producto IS NULL AND id_servicio IS NOT NULL)
    )
);

-- =========================
-- DESCUENTOS
-- =========================
DROP TABLE IF EXISTS descuentos CASCADE;
CREATE TABLE descuentos (
    id SERIAL PRIMARY KEY,
    codigo_cupon VARCHAR(50) UNIQUE,
    porcentaje_descuento DECIMAL(5,2) CHECK (porcentaje_descuento BETWEEN 0 AND 100),
    fecha_inicio TIMESTAMP,
    fecha_fin TIMESTAMP
);

-- =========================
-- RELACION PRODUCTO DESCUENTO
-- =========================
DROP TABLE IF EXISTS rel_descuento_items CASCADE;
CREATE TABLE rel_descuento_items (
    id SERIAL PRIMARY KEY, 
    id_descuento INT NOT NULL REFERENCES descuentos(id) ON DELETE CASCADE,
    id_producto INT REFERENCES productos(id) ON DELETE CASCADE,
    id_servicio INT REFERENCES servicios(id) ON DELETE CASCADE,
    CONSTRAINT check_descuento_target CHECK (
        (id_producto IS NOT NULL AND id_servicio IS NULL) OR 
        (id_producto IS NULL AND id_servicio IS NOT NULL)
    )
);

-- =========================
-- TABLA LISTAS DE DESEOS
-- =========================
DROP TABLE IF EXISTS listas_deseos CASCADE;
CREATE TABLE listas_deseos (
    id SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    nombre VARCHAR(100) DEFAULT 'Mis Favoritos',
    es_publica BOOLEAN DEFAULT FALSE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- TABLA ITEMS DE WISHLIST
-- =========================
DROP TABLE IF EXISTS wishlist_items CASCADE;
CREATE TABLE wishlist_items (
    id SERIAL PRIMARY KEY,
    id_lista INT NOT NULL REFERENCES listas_deseos(id) ON DELETE CASCADE,
    id_producto INT REFERENCES productos(id) ON DELETE CASCADE,
    id_servicio INT REFERENCES servicios(id) ON DELETE CASCADE,
    fecha_agregado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_wishlist_target CHECK (
        (id_producto IS NOT NULL AND id_servicio IS NULL) OR 
        (id_producto IS NULL AND id_servicio IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_unique_wishlist_producto ON wishlist_items(id_lista, id_producto) WHERE id_producto IS NOT NULL;
CREATE UNIQUE INDEX idx_unique_wishlist_servicio ON wishlist_items(id_lista, id_servicio) WHERE id_servicio IS NOT NULL;

-- =========================
-- TABLA RESEÑAS
-- =========================
DROP TABLE IF EXISTS resenas CASCADE;
CREATE TABLE resenas (
    id SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    id_producto INT REFERENCES productos(id) ON DELETE CASCADE,
    id_servicio INT REFERENCES servicios(id) ON DELETE CASCADE,
    calificacion INT NOT NULL CHECK (calificacion BETWEEN 1 AND 5),
    comentario TEXT,
    compra_verificada BOOLEAN DEFAULT FALSE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_resena_target CHECK (
        (id_producto IS NOT NULL AND id_servicio IS NULL) OR 
        (id_producto IS NULL AND id_servicio IS NOT NULL)
    )
);

-- =========================
-- TABLA INTERACCIONES USUARIO
-- =========================
DROP TABLE IF EXISTS interacciones_usuario CASCADE;
CREATE UNLOGGED TABLE interacciones_usuario (
    id BIGSERIAL PRIMARY KEY,
    id_usuario INT NOT NULL, 
    id_producto INT NOT NULL, 
    tipo_accion VARCHAR(20) NOT NULL, 
    fecha_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- RELACION SERVICIO-CATEGORIA
-- =========================
DROP TABLE IF EXISTS servicio_categoria CASCADE;
CREATE TABLE servicio_categoria (
    id_servicio INT NOT NULL,
    id_categoria INT NOT NULL,
    PRIMARY KEY (id_servicio, id_categoria),
    FOREIGN KEY (id_servicio) REFERENCES servicios(id) ON DELETE CASCADE,
    FOREIGN KEY (id_categoria) REFERENCES categorias(id) ON DELETE CASCADE
);

CREATE INDEX idx_interacciones_usuario ON interacciones_usuario(id_usuario, tipo_accion);
CREATE INDEX idx_interacciones_producto ON interacciones_usuario(id_producto);

CREATE UNIQUE INDEX idx_unique_resena_producto ON resenas(id_usuario, id_producto) WHERE id_producto IS NOT NULL;
CREATE UNIQUE INDEX idx_unique_resena_servicio ON resenas(id_usuario, id_servicio) WHERE id_servicio IS NOT NULL;


-- Galería de Productos
DROP TABLE IF EXISTS producto_imagenes CASCADE;
CREATE TABLE producto_imagenes (
    id SERIAL PRIMARY KEY,
    id_producto INT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    url_imagen TEXT NOT NULL,
    es_principal BOOLEAN DEFAULT FALSE,
    orden_visual INT DEFAULT 0, -- Para que el frontend sepa en qué orden mostrar el carrusel
    fecha_agregada TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Asegurarte de que solo haya una imagen principal por producto
CREATE UNIQUE INDEX idx_unica_img_principal_prod ON producto_imagenes (id_producto) WHERE es_principal = TRUE;


-- Galería de Servicios
DROP TABLE IF EXISTS servicio_imagenes CASCADE;
CREATE TABLE servicio_imagenes (
    id SERIAL PRIMARY KEY,
    id_servicio INT NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
    url_imagen TEXT NOT NULL,
    es_principal BOOLEAN DEFAULT FALSE,
    orden_visual INT DEFAULT 0,
    fecha_agregada TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_unica_img_principal_serv ON servicio_imagenes (id_servicio) WHERE es_principal = TRUE;


ALTER TABLE agenda_servicios
ADD CONSTRAINT evitar_choque_horarios
EXCLUDE USING gist (
    id_servicio WITH =,
    tsrange(fecha_hora_inicio, fecha_hora_fin) WITH &&
);




-- =========================
-- FUNCIONES Y TRIGGERS
-- =========================
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
    v_precio DECIMAL;
BEGIN
    IF NEW.id_producto IS NOT NULL THEN
        SELECT p.nombre, p.precio, pi.url_imagen INTO v_nombre, v_precio, v_imagen
        FROM productos p
        LEFT JOIN producto_imagenes pi ON p.id = pi.id_producto AND pi.es_principal = TRUE
        WHERE p.id = NEW.id_producto;

        NEW.precio_unitario_historico := COALESCE(v_precio, 0);
        NEW.snapshot_item := jsonb_build_object('nombre', v_nombre, 'imagen_principal', v_imagen);
        
    ELSIF NEW.id_servicio IS NOT NULL THEN
        SELECT s.nombre, s.precio_base, si.url_imagen INTO v_nombre, v_precio, v_imagen
        FROM servicios s
        LEFT JOIN servicio_imagenes si ON s.id = si.id_servicio AND si.es_principal = TRUE
        WHERE s.id = NEW.id_servicio;

        NEW.precio_unitario_historico := COALESCE(v_precio, 0);
        NEW.snapshot_item := jsonb_build_object('nombre', v_nombre, 'imagen_principal', v_imagen);
    END IF;
    
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
            SELECT precio INTO v_precio_item FROM productos WHERE id = v_item.id_producto FOR SHARE;
            
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
            SELECT precio_base INTO v_precio_item FROM servicios WHERE id = v_item.id_servicio FOR SHARE;
            
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

