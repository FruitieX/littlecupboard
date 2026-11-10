"""Build an idempotent household recipe patch; apply through /api/operations.

Input: current household state JSON. Output: operation JSON (no personal data).
Existing recipes are preserved, except additive spinach pancake serving notes.
"""
import copy
import json
import sys


def build(state, catalog):
    products = {p['id']: p for p in catalog + state['customProducts']}
    changes = []
    def ingredient(pid, qty, unit, note=''):
        if pid.startswith('@'):
            pid = next(p['id'] for p in products.values() if p['name'].casefold() == pid[1:].casefold())
        assert pid in products, pid
        return dict(productId=pid, quantity=qty, unit=unit, note=note)
    def add(key, name, minutes, active, tag, rows, steps, notes, servings=4, tags=None):
        rid = 'family-meals-' + key
        if any(r['id'] == rid for r in state['recipeBook']):
            return
        recipe = dict(id=rid, name=name, subtitle=f'{active} min active · Easy · '+notes,
                      image='', minutes=minutes, tag=tag, servings=servings,
                      ingredients=[ingredient(*r) for r in rows], steps=steps,
                      tags=tags or ['family-friendly'], mealPlanEligible=True)
        changes.append(dict(collection='recipeBook',key=rid,field=None,before=None,after=recipe))
    oil=('rapeseed-oil',1,'tbsp')
    pepper=('black-pepper',0.25,'tsp','To taste; adult portions can be seasoned separately')
    add('oven-salmon','Oven salmon, potatoes and carrots',40,10,'Fish',[
        ('salmon',500,'g','Boneless; check for remaining bones'),('potatoes',800,'g'),('carrots',350,'g'),oil,('lemon',1,'pc'),('dill',1,'tsp','Dried, or fresh to taste'),pepper],
        ['Heat oven to 200°C. Wash potatoes and cut into wedges; peel and slice carrots.',
         'Toss vegetables in the oil on a tray. Roast for 20 minutes.',
         'Add salmon in a separate oven dish or beside the vegetables. Season with lemon juice, dill and pepper.',
         'Bake another 15–20 minutes, until the fish is fully cooked, about 63°C internally. Check for bones.',
         'Serve components separately, keeping some fish plain if preferred.'],
        'Thaw frozen salmon safely in the refrigerator. Optional: cucumber on the side.',tags=['family-friendly','fish','oven','gluten-free','low-effort'])
    add('chicken-tray','Sheet-pan chicken and vegetables',45,15,'Chicken',[
        ('chicken-breast',550,'g','Boneless; unseasoned thigh fillets also work'),('potatoes',700,'g'),('carrots',350,'g'),('rapeseed-oil',2,'tbsp'),('paprika',1,'tsp','Mild'),('oregano',1,'tsp'),pepper],
        ['Heat oven to 200°C. Cut potatoes and carrots into similarly sized pieces.',
         'Toss vegetables with half the oil and roast on a tray for 15 minutes.',
         'Cut chicken into even pieces and coat with remaining oil, paprika and oregano. Add to tray; optional: add 1 sliced red pepper.',
         'Roast another 20–25 minutes until vegetables are tender and chicken reaches 75°C internally.',
         'Serve separately with familiar vegetables. Keep seasoning mild and add adult seasoning at the table.'],
        '4 portions; increase chicken deliberately for next-day wraps or rice. Refrigerate leftovers promptly.',tags=['family-friendly','chicken','oven','one-pan','low-effort','batch-cooking'])
    add('salmon-pasta','Creamy salmon pasta',25,20,'Fish',[
        ('salmon',400,'g','Boneless'),('pasta',300,'g','Dry'),('frozen-spinach',100,'g','Or 150 g frozen peas, according to tolerance'),('family-oat-cooking',200,'ml','Unsweetened; choose lower saturated fat'),oil,('lemon',1,'pc'),('dill',1,'tsp','Dried'),pepper],
        ['Cook pasta according to the packet; reserve some cooking water.',
         'Check salmon for bones and cut into bite-sized pieces. Gently cook in oil.',
         'Add oat cooking product and spinach (or peas). Simmer until fish is cooked through, about 63°C internally.',
         'Season with dill, pepper and a little lemon juice. Combine with pasta, loosening with pasta water.',
         'Serve immediately; reserve plain pasta and fish before mixing for anyone who prefers them separate.'],
        'Use familiar pasta first; introduce wholegrain gradually. Optional: a little grated cheese.',tags=['fish','pasta','family-friendly','quick'])
    add('macaroni','Finnish macaroni casserole with lean mince',65,20,'Casserole',[
        ('pasta',500,'g','Dry macaroni'),('minced-beef',500,'g','Lean, ideally 5–10% fat; or lean poultry mince'),('eggs',4,'pc'),('skimmed-milk',800,'ml','Lactose-free if preferred'),oil,pepper],
        ['Heat oven to 200°C. Cook macaroni until just short of tender.',
         'Brown lean mince in rapeseed oil. Optional: stir in 2 grated carrots and up to 150 g rinsed, drained canned lentils; begin with much less if tolerance is uncertain.',
         'Mix macaroni and meat in a large baking dish.',
         'Whisk eggs and milk with mild pepper and optional paprika and a little salt. Pour over macaroni.',
         'Bake 40–45 minutes until set and golden and meat is thoroughly cooked. Rest 5–10 minutes.',
         'Cool leftovers promptly and refrigerate; reheat portions thoroughly. Freeze spare portions.'],
        '8 portions, intentionally includes leftovers. Optional wholegrain macaroni and lentils can be introduced gradually. Original family casserole is preserved.',servings=8,tags=['family-favourite','batch-cooking','leftovers','oven'])
    add('fish-fingers','Fish fingers, mashed potatoes and peas',30,10,'Fish',[
        ('fish-fingers',450,'g','Frozen; choose high fish content and moderate salt'),('potatoes',800,'g'),('frozen-peas',200,'g'),('milk',125,'ml','Low-fat; lactose-free if preferred'),oil],
        ['Cook fish fingers in the oven according to their packet.',
         'Peel potatoes and boil until soft, then drain.',
         'Mash with warm milk and rapeseed oil; add a little extra milk if needed.',
         'Cook peas until tender. Serve all components separately, with optional sliced cucumber.'],
        'Very easy fallback. Familiar convenience meals are welcome; homemade breaded white fish is an optional later variation.',tags=['family-favourite','fish','quick','budget-friendly','convenience'])
    add('wraps','Build-your-own chicken wraps',25,20,'Chicken',[
        ('chicken-breast',450,'g','Unseasoned; or safely stored cooked leftover chicken'),('tortillas',6,'pc','Medium'),('cucumber',1,'pc'),('carrots',2,'pc'),('@Tomatoes',2,'pc'),('yogurt',150,'g','Lactose-free plain yoghurt'),oil,('paprika',0.5,'tsp','Mild'),pepper],
        ['Cut chicken into strips and cook in oil with mild paprika until it reaches 75°C internally. Reheat cooked leftover chicken thoroughly.',
         'Chop cucumber and tomatoes and grate carrots.',
         'Mix yoghurt with optional lemon juice for a garlic-free sauce.',
         'Warm tortillas and put all components in separate bowls. Optional: lettuce.',
         'Let everyone assemble wraps or eat the ingredients separately; keep plain tortilla and chicken available.'],
        'Use leftover sheet-pan chicken. Add adult seasoning separately.',tags=['family-friendly','interactive','chicken','vegetables','quick'])
    add('fried-rice','Egg fried rice and vegetables',30,15,'Vegetarian',[
        ('rice',250,'g','Dry; or about 700 g safely cooked and chilled rice'),('eggs',4,'pc'),('frozen-peas',150,'g'),('carrots',2,'pc'),('rapeseed-oil',1.5,'tbsp')],
        ['Cook rice according to its packet, or use safely chilled cooked rice.',
         'Finely dice or grate carrots. Heat oil in a large pan and cook carrots for a few minutes.',
         'Add peas and cook until hot. Push vegetables aside and scramble eggs until set.',
         'Add rice and stir-fry until thoroughly steaming hot throughout. Optional: add up to 1 tbsp reduced-salt soy sauce to adult portions.',
         'Serve plain rice, egg and vegetables separately if preferred.'],
        'Cool cooked rice rapidly, refrigerate promptly and reheat thoroughly; never leave it standing at room temperature. Frozen vegetables save time.',tags=['vegetarian','quick','budget-friendly','one-pan','family-friendly'])
    add('lentil-pasta','Tomato and lentil pasta',25,15,'Vegetarian',[
        ('pasta',300,'g','Dry'),('chopped-tomatoes',400,'g'),('lentils',120,'g','Canned cooked; drained and rinsed weight. Begin with less if needed'),('carrots',2,'pc'),oil,('@Basil',1,'tsp','Dried'),('oregano',1,'tsp'),pepper],
        ['Cook pasta according to its packet.',
         'Finely grate carrots and cook in oil for 3–4 minutes.',
         'Add tomatoes, basil and oregano, plus 100–150 ml water if needed. Simmer gently for 10 minutes.',
         'Stir in rinsed lentils and heat thoroughly. Optionally blend the sauce smooth.',
         'Serve with pasta; optional boiled eggs or cottage cheese add protein. Reserve plain pasta if preferred.'],
        'No onion or garlic. Start with a small lentil serving and adjust to personal tolerance; lean poultry mince is an alternative (cook thoroughly). Optional small cheese topping. Freeze spare sauce.',tags=['vegetarian','pasta','budget-friendly','fibre','meal-prep'])
    add('carrot-soup','Creamy carrot-potato soup',35,15,'Vegetarian',[
        ('carrots',750,'g'),('potatoes',450,'g'),('@Water',800,'ml','Or mild reduced-salt stock with no onion or garlic'),('family-oat-cooking',150,'ml','Unsweetened'),oil,pepper,('eggs',4,'pc','Boil and serve alongside')],
        ['Peel carrots and potatoes and cut into even chunks.',
         'Simmer in the water (or suitable stock) for about 20 minutes, until completely soft.',
         'Meanwhile boil eggs until fully set; cool enough to peel and cut for serving.',
         'Blend soup smooth. Stir in oat cooking product and rapeseed oil, adding water to adjust thickness.',
         'Season gently, adding a little salt only if needed. Serve with boiled eggs and optional wholegrain bread, separately if preferred.'],
        'Eggs provide protein; offer a familiar protein alternative if needed. Freeze soup in portions. Offer children adequate bread and toppings as needed.',tags=['vegetarian','soup','budget-friendly','batch-cooking','vegetables'])
    # Additive enrichment: retain the original oven method, quantities, photo and identity.
    old = next(r for r in state['recipeBook'] if r['name'] == 'Spinach pancakes')
    if not any('Pan-fried variation' in x for x in old['steps']):
        new = copy.deepcopy(old)
        new['steps'] += [
            'Serve with cottage cheese (about 250 g for 4 portions) and cucumber or grated carrot. Offer yoghurt or another familiar protein if preferred. Ready-made spinach pancakes are also fine.',
            'Pan-fried variation (4 portions, 25 minutes total, 20 minutes active): use 150 g thawed drained spinach, 200 g wheat flour, 450 ml low-fat milk, 3 eggs and 1 tbsp rapeseed oil plus a little for frying. Whisk eggs, milk and flour; stir in spinach and oil. Rest 5–10 minutes if possible, then fry small pancakes in a lightly oiled pan until set on both sides. Serve with 250 g cottage cheese and vegetables. Use lactose-free milk if preferred; introduce part wholegrain flour gradually.'
        ]
        changes.append(dict(collection='recipeBook',key=old['id'],field=None,before=old,after=new))
    return dict(type='patch', label='Add family meal candidates and restore tomato soup', changes=changes)

if __name__ == '__main__':
    state=json.load(open(sys.argv[1]))
    catalog=json.load(open('backend/seed.json'))['catalog']
    # Only genuinely missing products are added; existing IDs cover everything else.
    extra=[dict(id='family-oat-cooking',name='Oat cooking cream',category='Dairy' if 'Dairy' in state['groups'] else 'Ingredients',icon='🥛',aliases=['Kauraruoka','Oat-based cooking product'])]
    for p in extra:
        if not any(x['id']==p['id'] for x in state['customProducts']):
            state['customProducts'].append(p)
    op=build(state,catalog)
    for p in extra:
        if p['id'] not in {x['id'] for x in json.load(open(sys.argv[1]))['customProducts']}:
            op['changes'].insert(0,dict(collection='customProducts',key=p['id'],field=None,before=None,after=p))
    json.dump(op,sys.stdout,ensure_ascii=False,indent=2)
