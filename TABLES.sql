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
    fecha_expiracion VARCHAR(5) CHECK (fecha_expiracion ~ '^(0[1-9]|1[0-2])\/([0-9]{2})$'),
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
    nombre_categoria VARCHAR(100) NOT NULL,
    id_padre INT REFERENCES categorias(id), -- Aquí sucede la magia
    tipo VARCHAR(20) CHECK (tipo IN ('producto', 'servicio', 'ambos')),
    descripcion TEXT,
    UNIQUE (nombre_categoria, id_padre)
);

-- =========================
-- DESCUENTOS
-- =========================
DROP TABLE IF EXISTS descuentos CASCADE;
CREATE TABLE descuentos (
    id SERIAL PRIMARY KEY,
    id_negocio INT NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
    codigo_cupon VARCHAR(50) UNIQUE,
    porcentaje_descuento DECIMAL(5,2) CHECK (porcentaje_descuento BETWEEN 0 AND 100),
    fecha_inicio TIMESTAMP,
    fecha_fin TIMESTAMP
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
    id_descuento INT REFERENCES descuentos(id) ON DELETE SET null,
    embedding_vector vector(1536) 
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
    id_descuento INT REFERENCES descuentos(id) ON DELETE SET null,
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

CREATE INDEX idx_productos_descuento ON productos(id_descuento) WHERE id_descuento IS NOT NULL;
CREATE INDEX idx_servicios_descuento ON servicios(id_descuento) WHERE id_descuento IS NOT NULL;

