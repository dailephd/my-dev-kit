package com.example.combined

class MainActivity {
    fun showAppName() {
        val name = R.string.app_name
        val layout = R.layout.activity_main
        val color = R.color.brand_primary
        val tabs = R.array.tab_titles
        // R.string.commented_out_reference should never match anything
        val fake = "R.string.string_literal_reference"
    }
}

class SyncService
