CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;

-- =========================
-- TABLA ROLES
-- =========================
drop table if exists roles CASCADE;
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    nombre_rol VARCHAR(50) NOT NULL
);

-- =========================
-- TABLA USUARIOS
-- =========================

drop table if exists usuarios CASCADE;
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
    FOREIGN KEY (id_rol) REFERENCES roles(id)
);
CREATE INDEX idx_usuarios_activos ON usuarios(email) WHERE activo = TRUE;

-- =========================
-- TABLA DIRECCIONES
-- =========================
drop table if exists direcciones CASCADE;
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
drop table if exists rel_usuario_direcciones CASCADE;
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
drop table if exists metodos_pago CASCADE;
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
drop table if exists negocios CASCADE;
CREATE TABLE negocios (
    id SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL REFERENCES usuarios(id),
    nombre_comercial VARCHAR(150) NOT NULL,
    rfc_tax_id VARCHAR(50) UNIQUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- TABLA SUCURSALES
-- =========================
drop table if exists sucursales CASCADE;
CREATE TABLE sucursales(
    id SERIAL PRIMARY KEY,
    id_negocio INT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    nombre_sucursal VARCHAR(100), -- Ejemplo: 'Santa Fe', 'Mall del Sur'
    id_direccion INT NOT NULL REFERENCES direcciones(id)
);

-- =========================
-- TABLA CATEGORIAS
-- =========================
drop table if exists categorias CASCADE;
CREATE TABLE categorias (
    id SERIAL PRIMARY KEY,
    nombre_categoria VARCHAR(120) NOT NULL UNIQUE,
    descripcion TEXT
);

-- =========================
-- TABLA PRODUCTOS
-- =========================
drop table if exists productos CASCADE;
CREATE TABLE productos (
    id SERIAL PRIMARY KEY,
    id_negocio INT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    nombre VARCHAR(150) NOT NULL,
    descripcion TEXT,
    calificacion DECIMAL(2,1),
    precio DECIMAL(12,2) NOT NULL CHECK (precio >= 0),
    sku VARCHAR(100) UNIQUE,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    embedding_vector vector(1536) 
);

-- =========================
-- TABLA sucursal_inventario
-- =========================
drop table if exists sucursal_inventario CASCADE;
CREATE TABLE sucursal_inventario (
    id_sucursal INT NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
    id_producto INT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    stock_total INT NOT NULL DEFAULT 0 CHECK (stock_total >= 0),
    PRIMARY KEY (id_sucursal, id_producto)
);

-- =========================
-- TABLA manejo de lotes
-- =========================
drop table if exists lotes_inventario CASCADE;
CREATE TABLE lotes_inventario (
    id SERIAL PRIMARY KEY,
    id_sucursal INT NOT NULL,
    id_producto INT NOT NULL,
    stock_disponible INT NOT NULL DEFAULT 0 CHECK (stock_disponible >= 0),
    fecha_recibido DATE DEFAULT CURRENT_DATE,
    fecha_caducidad DATE NOT NULL,
    FOREIGN KEY (id_sucursal, id_producto) REFERENCES sucursal_inventario(id_sucursal, id_producto) ON DELETE CASCADE
);

-- =========================
-- RELACION PRODUCTO-CATEGORIA
-- =========================
drop table if exists producto_categoria CASCADE;
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
drop table if exists servicios CASCADE;
CREATE TABLE servicios (
    id SERIAL PRIMARY KEY,
    id_negocio INT NOT NULL,
    nombre VARCHAR(255) NOT NULL,
    descripcion TEXT,
    precio_base DECIMAL(10,2) NOT NULL,
    duracion_minutos INT,
    calificacion DECIMAL (2,1),
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (id_negocio) REFERENCES negocios(id) ON DELETE CASCADE
);

-- =========================
-- TABLA REL_sucursal_servicio
-- =========================
drop table if exists sucursal_servicio CASCADE;
CREATE TABLE sucursal_servicio (
    id_sucursal INT NOT NULL REFERENCES sucursales(id) ON DELETE CASCADE,
    id_servicio INT NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,    
    esta_activo BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (id_sucursal, id_servicio)
);


-- =========================
-- TABLA AGENDA SERVICIOS
-- =========================
drop table if exists agenda_servicios CASCADE;
CREATE TABLE agenda_servicios (
    id SERIAL PRIMARY KEY,
    id_servicio INT NOT NULL,
    id_sucursal INT NOT NULL,
    fecha_hora_inicio TIMESTAMP,
    fecha_hora_fin TIMESTAMP,
    estado VARCHAR(50) DEFAULT 'disponible',
    id_usuario_cliente INT,
    FOREIGN KEY (id_servicio) REFERENCES servicios(id),
    FOREIGN KEY (id_sucursal) REFERENCES sucursales(id),
    FOREIGN KEY (id_usuario_cliente) REFERENCES usuarios(id)
);

-- =========================
-- TABLA CARRITO
-- =========================
drop table if exists carrito CASCADE;
CREATE TABLE carrito (
    id SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL UNIQUE,
    FOREIGN KEY (id_usuario) REFERENCES usuarios(id)
);

-- =========================
-- TABLA CARRITO ITEMS
-- =========================
-- Carrito funcional para Productos Y Servicios
drop table if exists carrito_items CASCADE;
CREATE TABLE carrito_items (
    id SERIAL PRIMARY KEY, -- PK independiente para evitar conflictos nulos
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
drop table if exists pedidos CASCADE;
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
drop table if exists detalle_pedido CASCADE;
CREATE TABLE detalle_pedido (
    id SERIAL PRIMARY KEY,
    id_pedido INT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    id_sucursal INT NOT NULL REFERENCES sucursales(id),
    id_producto INT REFERENCES productos(id),
    id_servicio INT REFERENCES servicios(id),
    cantidad INT NOT NULL CHECK (cantidad > 0),
    precio_unitario_historico DECIMAL(12,2) NOT NULL,
    id_agenda_seleccionada INT REFERENCES agenda_servicios(id) ON DELETE SET null,
    CONSTRAINT check_detalle_type CHECK (
        (id_producto IS NOT NULL AND id_servicio IS NULL) OR 
        (id_producto IS NULL AND id_servicio IS NOT NULL)
    )
);


-- =========================
-- DESCUENTOS
-- =========================
drop table if exists descuentos CASCADE;
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

drop table if exists rel_descuento_items CASCADE;
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
drop table if exists listas_deseos CASCADE;
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
drop table if exists wishlist_items CASCADE;
CREATE TABLE wishlist_items (
    id SERIAL PRIMARY KEY,
    id_lista INT NOT NULL REFERENCES listas_deseos(id) ON DELETE CASCADE,
    id_producto INT REFERENCES productos(id) ON DELETE CASCADE,
    id_servicio INT REFERENCES servicios(id) ON DELETE CASCADE,
    fecha_agregado TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- REGLA 1: O es producto o es servicio
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
drop table if exists resenas CASCADE;
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



-- Usamos UNLOGGED para que las escrituras sean rapidísimas 
-- (Se salta el Write-Ahead Log de Postgres. Si hay un crash, se vacía, pero para analíticas es aceptable).
drop table if exists interacciones_usuario CASCADE;
CREATE UNLOGGED TABLE interacciones_usuario (
    id BIGSERIAL PRIMARY KEY,
    id_usuario INT NOT NULL, -- Sin FOREIGN KEY para no ralentizar el INSERT validando
    id_producto INT NOT NULL, -- Sin FOREIGN KEY
    tipo_accion VARCHAR(20) NOT NULL, -- 'visto', 'agregado_carrito', 'comprado'
    fecha_hora TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices cruciales para cuando quieras leer los datos y alimentar tu motor de recomendaciones
CREATE INDEX idx_interacciones_usuario ON interacciones_usuario(id_usuario, tipo_accion);
CREATE INDEX idx_interacciones_producto ON interacciones_usuario(id_producto);




CREATE OR REPLACE FUNCTION actualizar_promedio_calificacion()
RETURNS TRIGGER AS $$
DECLARE
    v_id_producto INT;
    v_id_servicio INT;
BEGIN
    -- Determinar los IDs dependiendo de si es INSERT, UPDATE o DELETE
    -- Usamos COALESCE: Si NEW es nulo (porque es un DELETE), usa OLD.
    IF TG_OP = 'DELETE' THEN
        v_id_producto := OLD.id_producto;
        v_id_servicio := OLD.id_servicio;
    ELSE
        v_id_producto := NEW.id_producto;
        v_id_servicio := NEW.id_servicio;
    END IF;

    -- Si la reseña es de un PRODUCTO
    IF v_id_producto IS NOT NULL THEN
        UPDATE productos
        SET calificacion = (
            SELECT ROUND(AVG(calificacion)::numeric, 1)
            FROM resenas
            WHERE id_producto = v_id_producto
        )
        WHERE id = v_id_producto;
    END IF;

    -- Si la reseña es de un SERVICIO
    IF v_id_servicio IS NOT NULL THEN
        UPDATE servicios
        SET calificacion = (
            SELECT ROUND(AVG(calificacion)::numeric, 1)
            FROM resenas
            WHERE id_servicio = v_id_servicio
        )
        WHERE id = v_id_servicio;
    END IF;

    RETURN NULL; -- Los triggers tipo AFTER deben retornar NULL
END;
$$ LANGUAGE plpgsql;

-- Este es el trigger que faltaba para ejecutar tu función
CREATE TRIGGER trg_actualizar_calificacion
AFTER INSERT OR UPDATE OR DELETE ON resenas
FOR EACH ROW
EXECUTE FUNCTION actualizar_promedio_calificacion();

-- REGLA 2: Un usuario solo puede dejar UNA reseña por producto/servicio.
-- Si quiere cambiar de opinión, hace un UPDATE, no un nuevo INSERT.
CREATE UNIQUE INDEX idx_unique_resena_producto ON resenas(id_usuario, id_producto) WHERE id_producto IS NOT NULL;
CREATE UNIQUE INDEX idx_unique_resena_servicio ON resenas(id_usuario, id_servicio) WHERE id_servicio IS NOT NULL;

