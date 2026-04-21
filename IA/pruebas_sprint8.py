from motor_prompt_V2 import MotorPromptV2, MockRepositorioV2
from extractor_entidades_V2 import ExtractorEntidades

repositorio = MockRepositorioV2()
motor       = MotorPromptV2(repositorio)
extractor   = ExtractorEntidades()


def sep(titulo):
    print(f"\n{'='*65}")
    print(f"  {titulo}")
    print(f"{'='*65}")


def imprimir_resultado(r):
    print(f"\n  Prompt      : {r.prompt_original}")
    print(f"  Evento      : {r.tipo_evento}")
    print(f"  Temática    : {r.tematica}")
    print(f"  Personas    : {r.personas}")
    print(f"  Items       : {r.total_items}")
    print(f"  Presupuesto : ${r.presupuesto_total_estimado:,.2f} MXN")
    print(f"  Latencia    : {r.latencia_ms} ms")
    print()

    for sc in r.subcatalogos:
        print(f"  ┌─ {sc.nombre.upper()}  (${sc.presupuesto_seccion:,.2f})")
        for item in sc.items:
            tipo_tag = "[SRV]" if item.tipo == "servicio" else "[PRD]"
            dto = f" -{int(item.descuento_porcentaje)}%" if item.descuento_porcentaje else ""
            print(f"  │  {tipo_tag} [{item.score_relevancia:.2f}] {item.nombre[:40]:<40} "
                  f"x{item.cantidad_sugerida} ${item.precio_total:,.0f}{dto}")
            print(f"  │       Razón: {item.razon_cantidad}")
            print(f"  │       Etiqueta: {item.etiqueta}")
        print(f"  └{'─'*60}")
    print()


# ─────────────────────────────────────────────────────────────────────────────
def test_1_fiesta_infantil_spiderman():
    sep("TEST 1 — Fiesta infantil Spiderman 10 personas")
    prompt = "Voy a tener una fiesta infantil de Spiderman para 10 niños"
    r = motor.procesar_prompt(prompt)
    imprimir_resultado(r)

    assert r.tipo_evento == "fiesta",          "Evento no detectado"
    assert r.personas == 10,                   "Personas incorrectas"
    assert len(r.subcatalogos) > 0,            "Sin subcatálogos"
    assert r.total_items > 0,                  "Sin items"

    # Verificar que piñata = 1 unidad
    for sc in r.subcatalogos:
        for item in sc.items:
            if "piñata" in item.nombre.lower() or "pinata" in item.nombre.lower():
                assert item.cantidad_sugerida == 1, "Piñata debería ser 1"

    print("  PASS — Test 1 correcto\n")


def test_2_boda_formal():
    sep("TEST 2 — Boda formal 80 personas")
    prompt = "Organizando una boda elegante de noche para 80 personas con temática clásica"
    r = motor.procesar_prompt(prompt)
    imprimir_resultado(r)

    assert r.tipo_evento == "boda",            "Evento no detectado"
    assert r.personas == 80,                   "Personas incorrectas"
    assert len(r.subcatalogos) >= 1,           "Sin subcatálogos para boda"

    # Verificar sillas: 1 por persona = 80
    for sc in r.subcatalogos:
        for item in sc.items:
            if "silla" in item.nombre.lower() and "plegable" in item.nombre.lower():
                assert item.cantidad_sugerida >= 70, f"Sillas deberían ser ~80, son {item.cantidad_sugerida}"

    print("  PASS — Test 2 correcto\n")


def test_3_xv_anos():
    sep("TEST 3 — Quinceañera para 50 personas")
    prompt = "Quinceañera para mi hija, somos 50 personas, quiero todo elegante"
    r = motor.procesar_prompt(prompt)
    imprimir_resultado(r)

    assert r.tipo_evento == "xv_anos",         "Evento no detectado"
    assert r.personas == 50,                   "Personas incorrectas"
    print("  PASS — Test 3 correcto\n")


def test_4_corporativo_con_servicios():
    sep("TEST 4 — Evento corporativo con servicios")
    prompt = "Necesito organizar una conferencia corporativa para 100 adultos, contratar seguridad y servicio de wifi"
    r = motor.procesar_prompt(prompt)
    imprimir_resultado(r)

    assert r.tipo_evento == "corporativo",     "Evento no detectado"
    assert r.personas == 100,                  "Personas incorrectas"

    # Debe incluir servicios
    tipos = set()
    for sc in r.subcatalogos:
        for item in sc.items:
            tipos.add(item.tipo)
    assert "servicio" in tipos, "Debería incluir servicios"

    print("  PASS — Test 4 correcto\n")


def test_5_con_presupuesto():
    sep("TEST 5 — Fiesta con presupuesto máximo $2,000")
    prompt = "Fiesta de cumpleaños para 15 niños, presupuesto máximo de $2000"
    r = motor.procesar_prompt(prompt)
    imprimir_resultado(r)

    assert r.personas == 15,                   "Personas incorrectas"
    for sc in r.subcatalogos:
        for item in sc.items:
            assert item.precio_unitario <= 2000, \
                f"Precio unitario excede presupuesto: {item.nombre} ${item.precio_unitario}"

    print("  PASS — Test 5 correcto\n")


def test_6_cantidad_implicita():
    sep("TEST 6 — Cantidad implícita ('fiesta grande')")
    prompt = "Quiero organizar una fiesta grande de cumpleaños para adultos"
    r = motor.procesar_prompt(prompt)
    imprimir_resultado(r)

    assert r.personas >= 15, f"Estimado muy bajo: {r.personas}"
    print("  PASS — Test 6 correcto\n")


def test_7_extractor_categorias():
    sep("TEST 7 — Categorías objetivo por tipo de evento")
    casos = [
        ("fiesta infantil para niños", "fiesta", ["Globos y Arte con Globos", "Piñatas", "Juguetes"]),
        ("boda elegante de noche", "boda", ["Vestidos de Novia", "Mobiliario"]),
        ("posada navideña familiar", "posada", ["Piñatas", "Dulcería y Relleno"]),
    ]

    for prompt, evento_esperado, cats_esperadas in casos:
        e = extractor.extraer(prompt)
        cats = extractor.obtener_categorias_objetivo(e)

        print(f"\n  Prompt: {prompt}")
        print(f"  Evento detectado: {e.tipo_evento}")
        print(f"  Categorías objetivo ({len(cats)}): {cats[:5]}...")

        assert e.tipo_evento == evento_esperado, \
            f"Evento esperado '{evento_esperado}', obtenido '{e.tipo_evento}'"
        for cat in cats_esperadas:
            assert cat in cats, f"Categoría '{cat}' no está en el mapeo"

    print("\n  PASS — Test 7 correcto\n")


def test_8_subcatalogos_correctos():
    sep("TEST 8 — Subcatálogos bien organizados")
    prompt = "Fiesta infantil de cumpleaños para 12 niños, quiero piñata, pastel y globos"
    r = motor.procesar_prompt(prompt)
    imprimir_resultado(r)

    nombres_sc = [sc.nombre for sc in r.subcatalogos]
    print(f"  Subcatálogos: {nombres_sc}")

    assert len(r.subcatalogos) >= 2, "Muy pocos subcatálogos"
    for sc in r.subcatalogos:
        assert len(sc.items) > 0, f"Subcatálogo '{sc.nombre}' vacío"
        assert sc.presupuesto_seccion > 0, f"Presupuesto 0 en '{sc.nombre}'"

    print("  PASS — Test 8 correcto\n")


if __name__ == "__main__":
    print("\n" + "="*65)
    print("  Proyecto")
    print("="*65)

    tests = [
        test_1_fiesta_infantil_spiderman,
        test_2_boda_formal,
        test_3_xv_anos,
        test_4_corporativo_con_servicios,
        test_5_con_presupuesto,
        test_6_cantidad_implicita,
        test_7_extractor_categorias,
        test_8_subcatalogos_correctos,
    ]

    pasados = fallidos = 0
    for test in tests:
        try:
            test()
            pasados += 1
        except AssertionError as e:
            print(f"  FAIL — {e}\n")
            fallidos += 1
        except Exception as e:
            print(f"  ERROR — {e}\n")
            import traceback; traceback.print_exc()
            fallidos += 1

    print("="*65)
    print(f"  RESULTADO:  {pasados} pasados  |  {fallidos} fallidos")
    print("="*65 + "\n")