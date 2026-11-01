const val DETECTOR_ID = "kotlin-detector"

class ObservationsKotlin {
    @Test
    fun runs() {
        ProcessBuilder("npm", "run", "build").start()
    }
}
