// Empêche l'ouverture d'une console noire en version finale sous Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    dynamic_island_lib::run()
}
